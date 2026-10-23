import fs from 'node:fs';
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { v4 as uuidv4 } from 'uuid';
import type {
  DirEntryInfo,
  FileInfo,
  FsClient,
  FsClientSettings,
  JsonRead,
  LinkInfo,
} from './fs.types.js';

const errorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined;

/** Nothing at the path, or a file where a folder was expected on the way: both mean absent. */
const isAbsent = (error: unknown): boolean => {
  const code: string | undefined = errorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR';
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const statFactory =
  (_settings: FsClientSettings) =>
  async (file: string): Promise<FileInfo | null> => {
    try {
      const info: fs.Stats = await stat(file);
      return { isFile: info.isFile(), isDirectory: info.isDirectory(), size: info.size };
    } catch (error: unknown) {
      if (isAbsent(error)) return null;
      throw error;
    }
  };

/** Like `stat`, but the path itself: a symlink is reported as one, never followed. */
const lstatFactory =
  (_settings: FsClientSettings) =>
  async (file: string): Promise<LinkInfo | null> => {
    try {
      const info: fs.Stats = await lstat(file);
      return { isSymbolicLink: info.isSymbolicLink(), isDirectory: info.isDirectory() };
    } catch (error: unknown) {
      if (isAbsent(error)) return null;
      throw error;
    }
  };

const realpathFactory =
  (_settings: FsClientSettings) =>
  async (file: string): Promise<string | null> => {
    try {
      return await realpath(file);
    } catch (error: unknown) {
      if (isAbsent(error)) return null;
      throw error;
    }
  };

const readTextFactory =
  (_settings: FsClientSettings) =>
  (file: string): Promise<string> =>
    readFile(file, 'utf8');

const readJsonFactory =
  (settings: FsClientSettings) =>
  async (file: string): Promise<JsonRead> => {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (error: unknown) {
      if (isAbsent(error)) return { ok: false, reason: 'missing', message: errorMessage(error) };
      throw error;
    }
    try {
      return { ok: true, value: JSON.parse(text) as unknown };
    } catch (error: unknown) {
      settings.logger?.debug('unparseable json', { file, message: errorMessage(error) });
      return { ok: false, reason: 'unparseable', message: errorMessage(error) };
    }
  };

const sizeOf = async (file: string): Promise<number> => {
  try {
    const info: fs.Stats = await stat(file);
    return info.size;
  } catch {
    return 0;
  }
};

const listDirFactory =
  (_settings: FsClientSettings) =>
  async (dir: string): Promise<DirEntryInfo[]> => {
    let entries: fs.Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error: unknown) {
      if (isAbsent(error)) return [];
      throw error;
    }
    return Promise.all(
      entries.map(async (entry: fs.Dirent): Promise<DirEntryInfo> => ({
        name: entry.name,
        isFile: entry.isFile(),
        isDirectory: entry.isDirectory(),
        size: entry.isFile() ? await sizeOf(path.join(dir, entry.name)) : 0,
      })),
    );
  };

const subdirectoriesFactory =
  (settings: FsClientSettings) =>
  async (dir: string): Promise<string[]> => {
    const entries: DirEntryInfo[] = await listDirFactory(settings)(dir);
    return entries
      .filter((entry: DirEntryInfo): boolean => entry.isDirectory)
      .map((entry: DirEntryInfo): string => entry.name);
  };

const openReadFactory =
  (_settings: FsClientSettings) =>
  (file: string): Readable =>
    fs.createReadStream(file);

/**
 * Temp file beside the target, then rename: a reader sees the old bytes or the new ones,
 * never half of each.
 */
const writeTextAtomicFactory =
  (settings: FsClientSettings) =>
  async (file: string, text: string): Promise<number> => {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp: string = `${file}.${uuidv4()}.tmp`;
    try {
      await writeFile(tmp, text, 'utf8');
      await rename(tmp, file);
    } catch (error: unknown) {
      await rm(tmp, { force: true });
      throw error;
    }
    const bytes: number = Buffer.byteLength(text, 'utf8');
    settings.logger?.debug('file written', { file, bytes });
    return bytes;
  };

const writePrivateTextFactory =
  (_settings: FsClientSettings) =>
  async (dir: string, name: string, text: string): Promise<string> => {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file: string = path.join(dir, name);
    await writeFile(file, text, { encoding: 'utf8', mode: 0o600 });
    return file;
  };

const symlinkFactory =
  (settings: FsClientSettings) =>
  async (target: string, link: string): Promise<void> => {
    await mkdir(path.dirname(link), { recursive: true });
    await symlink(target, link, 'dir');
    settings.logger?.debug('link made', { link, target });
  };

/** mkdir -p the parent of `to`, then one rename: the folder is never half moved. */
const moveFactory =
  (settings: FsClientSettings) =>
  async (from: string, to: string): Promise<void> => {
    await mkdir(path.dirname(to), { recursive: true });
    await rename(from, to);
    settings.logger?.debug('moved', { from, to });
  };

export const createFsClient = (settings: FsClientSettings): FsClient => ({
  stat: statFactory(settings),
  lstat: lstatFactory(settings),
  realpath: realpathFactory(settings),
  readText: readTextFactory(settings),
  readJson: readJsonFactory(settings),
  listDir: listDirFactory(settings),
  subdirectories: subdirectoriesFactory(settings),
  openRead: openReadFactory(settings),
  writeTextAtomic: writeTextAtomicFactory(settings),
  writePrivateText: writePrivateTextFactory(settings),
  symlink: symlinkFactory(settings),
  move: moveFactory(settings),
});
