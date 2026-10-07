import type { FileSystemAdapter } from '../file-system/index.js';
import type { PermissionMode, TierMap } from '../../features/harness/index.js';
import type { Reported } from '../../features/run/index.js';
import type { LoggerPort } from '../../shared/types/logger.types.js';
import type { RunProcess } from '../../shared/utils/process.utils.js';

/** What every harness adapter is built from. Each adapter adds what only it needs. */
export interface HarnessAdapterSettings {
  /** The harness binary. */
  bin: string;
  /** A headless step cannot be asked for permission, so this decides everything it may do. */
  permissionMode: PermissionMode;
  /** One step may run this long before it is killed and recorded as failed. */
  timeoutMs: number;
  /** tier → model id. An unmapped tier passes no model flag. */
  models?: TierMap;
  /** The model for a step that names none. Absent: the harness default runs. */
  defaultModel?: string;
  logger?: LoggerPort;
  /** Injected so a test never starts a real process. */
  runProcess?: RunProcess;
}

/** An adapter that must hand its harness a file writes it through this, never on its own. */
export interface ScratchSettings {
  fileSystem: Pick<FileSystemAdapter, 'writeText'>;
  /** Where scratch files go when the request names no run folder. */
  tempDir: string;
}

/** What could be read out of an agent's answer. No event is an answer too — it is asked again. */
export interface ParsedAnswer {
  event?: string;
  reported: Reported;
}
