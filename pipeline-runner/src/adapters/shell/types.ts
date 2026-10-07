import type { ShellPort } from '../../features/run/index.js';
import type { LoggerPort } from '../../shared/types/logger.types.js';
import type { RunProcess } from '../../shared/utils/process.utils.js';

export interface ShellAdapterSettings {
  /** The shell a hook command is handed to. */
  shell: string;
  timeoutMs: number;
  logger?: LoggerPort;
  runProcess?: RunProcess;
}

export type ShellAdapter = ShellPort;
