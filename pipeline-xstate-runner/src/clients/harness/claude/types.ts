import type { LoggerPort } from '../../../shared/utils/logger.js';
import type { RunProcess } from '../../process/types.js';

/** Claude Code's own permission modes, passed through by name. */
export const CLAUDE_PERMISSION_MODES = [
  'acceptEdits',
  'auto',
  'bypassPermissions',
  'manual',
  'dontAsk',
  'plan',
] as const;

export type ClaudePermissionMode = (typeof CLAUDE_PERMISSION_MODES)[number];

export interface ClaudeClientSettings {
  /** The harness binary. */
  bin: string;
  /** A headless step cannot be asked for permission, so this decides everything it may do. */
  permissionMode: ClaudePermissionMode;
  /** The model for a step that names none. Absent: the harness default runs. */
  defaultModel?: string;
  /** Where Claude Code keeps transcripts (`<home>/.claude/projects/...`). */
  homePath: string;
  logger?: LoggerPort;
  /** Injected so a test never starts a real process. */
  runProcess?: RunProcess;
}
