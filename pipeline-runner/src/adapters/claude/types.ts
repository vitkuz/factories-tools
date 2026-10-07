import type { PermissionMode } from '../../features/harness/index.js';
import type { AgentPort } from '../../features/run/index.js';
import type { HarnessAdapterSettings } from '../agent-shared/index.js';

/** The runner's permission modes are Claude Code's own, so here they pass through by name. */
export type ClaudePermissionMode = PermissionMode;

export interface ClaudeAdapterSettings extends HarnessAdapterSettings {
  /** Where Claude Code keeps transcripts (`<home>/.claude/projects/...`). */
  homePath: string;
}

/** The runner's AgentPort, carried out by one headless `claude -p` process per call. */
export type ClaudeAdapter = AgentPort;
