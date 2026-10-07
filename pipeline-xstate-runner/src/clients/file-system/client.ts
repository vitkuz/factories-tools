// Learned from factories-tools/run-state/src/clients/file-system/client.ts
import fs from 'node:fs';
import path from 'node:path';
import fastGlob from 'fast-glob';
import type { FileSystemClient } from './types.js';

/** Synchronous on purpose: every effect is one short shot, and the services stay plain functions. */
const readText = (file: string): string => fs.readFileSync(file, 'utf8');

const exists = (target: string): boolean => fs.existsSync(target);

const isDirectory = (target: string): boolean => {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
};

const listDirectories = (directory: string): string[] =>
  exists(directory)
    ? fs
        .readdirSync(directory, { withFileTypes: true })
        .filter((entry: fs.Dirent): boolean => entry.isDirectory())
        .map((entry: fs.Dirent): string => entry.name)
        .sort()
    : [];

const makeDirectory = (directory: string): void => {
  fs.mkdirSync(directory, { recursive: true });
};

const writeTextAtomic = (file: string, text: string): void => {
  makeDirectory(path.dirname(file));
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, file);
};

const writeText = (file: string, text: string): void => {
  makeDirectory(path.dirname(file));
  fs.writeFileSync(file, text);
};

const appendLine = (file: string, line: string): void => {
  makeDirectory(path.dirname(file));
  fs.appendFileSync(file, `${line}\n`);
};

const glob = (pattern: string): string[] =>
  fastGlob
    .sync(pattern.split(path.sep).join('/'), { onlyFiles: true, absolute: true, dot: true })
    .sort();

export const createFileSystemClient = (): FileSystemClient => ({
  readText,
  exists,
  isDirectory,
  listDirectories,
  makeDirectory,
  writeTextAtomic,
  writeText,
  appendLine,
  glob,
});
