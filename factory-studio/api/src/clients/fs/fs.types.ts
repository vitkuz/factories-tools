import type { Readable } from 'node:stream';
import type { AppLogger } from '../../shared/types.js';

export interface FileInfo {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
}

export interface DirEntryInfo {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  size: number;
}

export type JsonRead =
  { ok: true; value: unknown } | { ok: false; reason: 'missing' | 'unparseable'; message: string };

export interface FsClientSettings {
  logger?: AppLogger;
}

/** The one place that touches the disk. Every path it receives was already checked. */
export interface FsClient {
  /** `null` when there is nothing at the path. */
  stat: (file: string) => Promise<FileInfo | null>;
  /** The path with every symlink resolved; `null` when there is nothing at the path. */
  realpath: (file: string) => Promise<string | null>;
  readText: (file: string) => Promise<string>;
  readJson: (file: string) => Promise<JsonRead>;
  /** `[]` when the folder is absent. */
  listDir: (dir: string) => Promise<DirEntryInfo[]>;
  /** Names of the sub-folders, `[]` when the folder is absent. */
  subdirectories: (dir: string) => Promise<string[]>;
  openRead: (file: string) => Readable;
  /** mkdir -p the parent, write `<file>.<uuid>.tmp`, rename over `file`; returns UTF-8 bytes. */
  writeTextAtomic: (file: string, text: string) => Promise<number>;
  /** mkdir `dir` 0700, write `<dir>/<name>` 0600; returns the file path. */
  writePrivateText: (dir: string, name: string, text: string) => Promise<string>;
  /** mkdir -p the parent of `link`, then a symbolic link `link` → `target` (kept as given, relative or not). */
  symlink: (target: string, link: string) => Promise<void>;
}
