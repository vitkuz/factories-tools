import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWatchClient } from '../src/clients/watch/watch.client.js';
import type { TreeWatch, WatchEvent } from '../src/clients/watch/watch.types.js';
import { quiet } from './work-dir.js';

/** Resolves once `pick` is satisfied by the events so far, or rejects after `ms`. */
const until = (
  events: WatchEvent[],
  pick: (events: WatchEvent[]) => boolean,
  ms = 3000,
): Promise<void> =>
  new Promise<void>((resolve, reject): void => {
    const started: number = Date.now();
    const look = (): void => {
      if (pick(events)) return resolve();
      if (Date.now() - started > ms)
        return reject(new Error(`timed out; saw ${JSON.stringify(events)}`));
      setTimeout(look, 15);
    };
    look();
  });

const settle = (ms = 150): Promise<void> =>
  new Promise((resolve): void => void setTimeout(resolve, ms));

/** The recorder's write: a temp file beside the target, then one rename over it. */
const writeLikeRecorder = async (
  dir: string,
  name: string,
  body: string,
  n: number,
): Promise<void> => {
  const tmp: string = path.join(dir, `${name}.tmp-${n}`);
  await writeFile(tmp, body);
  await rename(tmp, path.join(dir, name));
};

describe('watch client (per-folder inotify watches)', () => {
  let root: string;
  let events: WatchEvent[];
  let watch: TreeWatch | null = null;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'watch-client-test-'));
    await mkdir(path.join(root, 'run', 'pipe', 'old-run'), { recursive: true });
    await writeFile(path.join(root, 'run', 'pipe', 'old-run', 'state.json'), '{}');
    events = [];
  });

  afterEach(async () => {
    watch?.stop();
    watch = null;
    await rm(root, { recursive: true, force: true });
  });

  const count = (suffix: string): number =>
    events.filter((e: WatchEvent): boolean => e.path.endsWith(suffix)).length;

  it('reports every recorder-style rewrite of state.json in a folder created after the watch started', async () => {
    watch = createWatchClient({ logger: quiet }).watchTree(
      path.join(root, 'run'),
      (e: WatchEvent) => void events.push(e),
    );
    await settle();
    const newRun: string = path.join(root, 'run', 'pipe', 'new-run');
    await mkdir(newRun);
    await until(events, (): boolean => count('pipe/new-run') > 0);
    for (let n = 1; n <= 6; n += 1) {
      events.length = 0;
      await writeLikeRecorder(newRun, 'state.json', JSON.stringify({ n }), n);
      // The one that fails with fs.watch({ recursive: true }) on Linux from n = 3 on.
      await until(events, (): boolean => count('pipe/new-run/state.json') > 0);
    }
    // A plain overwrite too.
    events.length = 0;
    await writeFile(path.join(newRun, 'state.json'), '{"plain":true}');
    await until(events, (): boolean => count('pipe/new-run/state.json') > 0);
  });

  it('follows folders made inside the new folder, and nested ones made at once', async () => {
    watch = createWatchClient({ logger: quiet }).watchTree(
      path.join(root, 'run'),
      (e: WatchEvent) => void events.push(e),
    );
    await settle();
    await mkdir(path.join(root, 'run', 'pipe2', 'r1', '1-step'), { recursive: true });
    await until(events, (): boolean => count('pipe2/r1/1-step') > 0);
    events.length = 0;
    await writeFile(path.join(root, 'run', 'pipe2', 'r1', '1-step', 'out.md'), '# out');
    await until(events, (): boolean => count('pipe2/r1/1-step/out.md') > 0);
    events.length = 0;
    await writeLikeRecorder(path.join(root, 'run', 'pipe2', 'r1'), 'state.json', '{}', 1);
    await writeLikeRecorder(path.join(root, 'run', 'pipe2', 'r1'), 'state.json', '{"x":1}', 2);
    await writeLikeRecorder(path.join(root, 'run', 'pipe2', 'r1'), 'state.json', '{"x":2}', 3);
    await until(events, (): boolean => count('pipe2/r1/state.json') >= 3);
  });

  it('reports a folder that goes, and keeps reporting the ones that stay', async () => {
    watch = createWatchClient({ logger: quiet }).watchTree(
      path.join(root, 'run'),
      (e: WatchEvent) => void events.push(e),
    );
    await settle();
    await rm(path.join(root, 'run', 'pipe', 'old-run'), { recursive: true });
    await until(events, (): boolean => count('pipe/old-run') > 0);
    events.length = 0;
    await mkdir(path.join(root, 'run', 'pipe', 'again'));
    await writeLikeRecorder(path.join(root, 'run', 'pipe', 'again'), 'state.json', '{}', 1);
    await until(events, (): boolean => count('pipe/again/state.json') > 0);
  });

  it('waits for a root that is not there yet and announces one rescan when it appears', async () => {
    const late: string = path.join(root, 'later');
    watch = createWatchClient({ logger: quiet, retryMs: 100 }).watchTree(
      late,
      (e: WatchEvent) => void events.push(e),
    );
    await settle();
    await mkdir(path.join(late, 'pipe', 'r1'), { recursive: true });
    await until(events, (): boolean => events.some((e: WatchEvent): boolean => e.path === ''));
    events.length = 0;
    await writeLikeRecorder(path.join(late, 'pipe', 'r1'), 'state.json', '{}', 1);
    await until(events, (): boolean => count('pipe/r1/state.json') > 0);
  });
});
