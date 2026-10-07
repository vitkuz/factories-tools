import type { LoggerPort } from '../../shared/utils/logger.js';
import type { RunProcess } from '../process/types.js';

export interface ShellResult {
  command: string;
  exitCode: number;
  output: string;
}

/** Runs one line of shell (a hook) from a working directory. */
export interface ShellClient {
  run: (command: string, cwd: string) => Promise<ShellResult>;
}

export interface ShellClientSettings {
  /** The shell a hook command is handed to. */
  shell: string;
  timeoutMs: number;
  logger?: LoggerPort;
  runProcess?: RunProcess;
}
