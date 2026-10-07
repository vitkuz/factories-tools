import type { LoggerPort } from '../../shared/types/logger.types.js';

export interface FileSystemAdapterSettings {
  logger?: LoggerPort;
}

export interface FileSystemAdapter {
  readText: (file: string) => Promise<string>;
  writeText: (file: string, text: string) => Promise<void>;
  /** The whole new file or the previous one — never a half-written state file. */
  writeJsonAtomic: (file: string, value: unknown) => Promise<void>;
  exists: (target: string) => Promise<boolean>;
  isDirectory: (target: string) => Promise<boolean>;
  makeDir: (directory: string) => Promise<void>;
  /** Absolute pattern in, absolute files out, sorted so every run lists them the same way. */
  glob: (pattern: string) => Promise<string[]>;
}
