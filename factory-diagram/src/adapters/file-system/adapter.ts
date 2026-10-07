import fs from 'node:fs';
import path from 'node:path';
import type { FileSystemAdapter } from './types.js';

/**
 * Synchronous on purpose: the CLI is one shot — read a file, write a file — and a sync adapter
 * keeps every service a plain function the tests can call without awaiting.
 */
const readText = (file: string): string => fs.readFileSync(file, 'utf8');

const exists = (target: string): boolean => fs.existsSync(target);

const isDirectory = (target: string): boolean => {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
};

/** Skips the write when the bytes match, so an unchanged diagram keeps its mtime (and git stays quiet). */
const writeText = (file: string, text: string): boolean => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (exists(file) && readText(file) === text) return false;
  fs.writeFileSync(file, text, 'utf8');
  return true;
};

const listDirectories = (directory: string): string[] =>
  exists(directory)
    ? fs
        .readdirSync(directory, { withFileTypes: true })
        .filter((entry: fs.Dirent): boolean => entry.isDirectory())
        .map((entry: fs.Dirent): string => entry.name)
        .sort()
    : [];

export const createFileSystemAdapter = (): FileSystemAdapter => ({
  readText,
  writeText,
  exists,
  isDirectory,
  listDirectories,
});
