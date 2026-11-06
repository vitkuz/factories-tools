import fs, { type FSWatcher } from 'node:fs';
import path from 'node:path';
import type { TreeWatch, WatchClient, WatchClientSettings, WatchEvent } from './watch.types.js';

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A real directory at `abs` (a symlink to one is not followed). */
const isPlainDir = (abs: string): boolean => {
  try {
    const info: fs.Stats = fs.lstatSync(abs);
    return info.isDirectory() && !info.isSymbolicLink();
  } catch {
    return false;
  }
};

const under = (dir: string, abs: string): boolean =>
  abs === dir || abs.startsWith(`${dir}${path.sep}`);

/**
 * The tree watcher: one plain (non-recursive) inotify watch per directory, added as directories
 * appear and dropped as they go. Not `fs.watch(dir, { recursive: true })`: on Linux that is a
 * JavaScript shim that puts a watch on every *file* and reports a known name only through its
 * file's inode watch — so a file replaced by `rename` (the recorder's `state.json.tmp-<pid>` →
 * `state.json`) goes quiet after its second write, and it spends an inotify slot per file. A
 * directory watch reports every child by name, whatever inode it is, and costs one slot per
 * folder.
 *
 * A root that is not there yet is waited for through its parent. A watcher error (ENOSPC, a
 * folder gone) drops that folder's watch; the tree is walked again after `retryMs` and one
 * nameless event (`path: ''`) tells the caller to read everything again.
 */
const watchTreeFactory =
  ({ logger, retryMs = 2000 }: WatchClientSettings) =>
  (root: string, onEvent: (event: WatchEvent) => void): TreeWatch => {
    let watchers: ReadonlyMap<string, FSWatcher> = new Map();
    let timer: NodeJS.Timeout | undefined;
    let stopped = false;

    const relative = (abs: string): string => path.relative(root, abs).split(path.sep).join('/');

    const later = (fn: () => void): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout((): void => {
        timer = undefined;
        if (!stopped) fn();
      }, retryMs);
      timer.unref();
    };

    /** Closes the watch of `dir` and of every folder under it. */
    const drop = (dir: string): void => {
      for (const [abs, watcher] of watchers) if (under(dir, abs)) watcher.close();
      watchers = new Map(
        [...watchers].filter(([abs]: [string, FSWatcher]): boolean => !under(dir, abs)),
      );
    };

    const fail = (dir: string, error: unknown): void => {
      logger?.warn('watch failed; the tree is walked again shortly', {
        dir,
        message: errorMessage(error),
      });
      drop(dir);
      later(recover);
    };

    /**
     * Makes sure `dir` and every folder under it are watched. `announce` reports each entry met
     * on the way as a `rename`, for a folder that appeared with contents before its watch was on.
     */
    const ensure = (dir: string, announce: boolean): void => {
      if (stopped) return;
      if (!watchers.has(dir)) {
        let watcher: FSWatcher;
        try {
          watcher = fs.watch(
            dir,
            { persistent: false },
            (type: string, filename: string | Buffer | null): void =>
              onDirEvent(dir, type, filename),
          );
        } catch (error: unknown) {
          fail(dir, error);
          return;
        }
        watcher.on('error', (error: unknown): void => fail(dir, error));
        watchers = new Map([...watchers, [dir, watcher]]);
      }
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const child: string = path.join(dir, entry.name);
        if (announce) onEvent({ type: 'rename', path: relative(child) });
        if (entry.isDirectory() && !entry.isSymbolicLink()) ensure(child, announce);
      }
    };

    const onDirEvent = (dir: string, type: string, filename: string | Buffer | null): void => {
      if (stopped) return;
      if (filename === null || String(filename) === '') {
        // inotify could not say which entry (an overflow, or the folder itself went).
        if (!isPlainDir(dir)) {
          drop(dir);
          if (dir === root) {
            onEvent({ type: 'rename', path: '' });
            waitForRoot();
            return;
          }
        }
        onEvent({ type: 'rename', path: dir === root ? '' : relative(dir) });
        return;
      }
      const child: string = path.join(dir, String(filename));
      onEvent({ type: type === 'rename' ? 'rename' : 'change', path: relative(child) });
      if (type !== 'rename') return;
      // A folder came (watch it, and what it already holds) or went (drop its watches).
      if (isPlainDir(child)) {
        if (!watchers.has(child)) ensure(child, true);
      } else if (watchers.has(child)) {
        drop(child);
      }
    };

    /** After a failure: watch whatever is not watched yet, and ask for one full read. */
    const recover = (): void => {
      if (stopped) return;
      if (!isPlainDir(root)) {
        drop(root);
        waitForRoot();
        return;
      }
      ensure(root, false);
      onEvent({ type: 'rename', path: '' });
    };

    /** The parent, flat, until `root` appears; then the real watch. */
    const waitForRoot = (): void => {
      if (stopped) return;
      const parent: string = path.dirname(root);
      const name: string = path.basename(root);
      if (!isPlainDir(parent)) {
        later(start);
        return;
      }
      try {
        const watcher: FSWatcher = fs.watch(
          parent,
          { persistent: false },
          (_type: string, filename: string | Buffer | null): void => {
            if (String(filename ?? '') !== name || !isPlainDir(root)) return;
            watcher.close();
            start();
            // Whatever was created with the folder is announced as one rescan.
            onEvent({ type: 'rename', path: '' });
          },
        );
        watcher.on('error', (error: unknown): void => {
          logger?.warn('watch of parent failed; retrying', {
            dir: root,
            message: errorMessage(error),
          });
          watcher.close();
          later(start);
        });
        // Kept under the root's key so `stop` closes it.
        watchers = new Map([...watchers, [root, watcher]]);
        logger?.info('waiting for folder', { dir: root });
      } catch (error: unknown) {
        logger?.warn('cannot watch parent; retrying', { dir: root, message: errorMessage(error) });
        later(start);
      }
    };

    const start = (): void => {
      if (stopped) return;
      drop(root);
      if (!isPlainDir(root)) {
        waitForRoot();
        return;
      }
      ensure(root, false);
      logger?.info('watching', { dir: root, folders: watchers.size });
    };

    start();

    return {
      stop: (): void => {
        stopped = true;
        if (timer) clearTimeout(timer);
        timer = undefined;
        for (const watcher of watchers.values()) watcher.close();
        watchers = new Map();
      },
    };
  };

export const createWatchClient = (settings: WatchClientSettings): WatchClient => ({
  watchTree: watchTreeFactory(settings),
});
