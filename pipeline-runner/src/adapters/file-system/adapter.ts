import fs from 'node:fs/promises';
import path from 'node:path';
import fastGlob from 'fast-glob';
import { v4 as uuid } from 'uuid';
import type { FileSystemAdapter, FileSystemAdapterSettings } from './types.js';

const readText = (file: string): Promise<string> => fs.readFile(file, 'utf8');

const makeDir = async (directory: string): Promise<void> => {
  await fs.mkdir(directory, { recursive: true });
};

const writeText = async (file: string, text: string): Promise<void> => {
  await makeDir(path.dirname(file));
  await fs.writeFile(file, text, 'utf8');
};

const writeJsonAtomicFactory =
  (settings: FileSystemAdapterSettings) =>
  async (file: string, value: unknown): Promise<void> => {
    const directory = path.dirname(path.resolve(file));
    const temp = path.join(directory, `.${path.basename(file)}-${uuid().slice(0, 8)}.tmp`);
    await makeDir(directory);
    try {
      await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await fs.rename(temp, file);
    } catch (error) {
      settings.logger?.error('atomic write failed', { file });
      await fs.rm(temp, { force: true });
      throw error;
    }
  };

const exists = (target: string): Promise<boolean> =>
  fs.access(target).then(
    (): boolean => true,
    (): boolean => false,
  );

const isDirectory = (target: string): Promise<boolean> =>
  fs.stat(target).then(
    (stats): boolean => stats.isDirectory(),
    (): boolean => false,
  );

const glob = async (pattern: string): Promise<string[]> => {
  const files: string[] = await fastGlob(pattern, { absolute: true, onlyFiles: true, dot: true });
  return [...files].sort();
};

export const createFileSystemAdapter = (
  settings: FileSystemAdapterSettings = {},
): FileSystemAdapter => ({
  readText,
  writeText,
  writeJsonAtomic: writeJsonAtomicFactory(settings),
  exists,
  isDirectory,
  makeDir,
  glob,
});
