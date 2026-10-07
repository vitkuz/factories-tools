import { permissionArgs } from './codex.utils.js';
import { runAgentFactory } from './operations/run-agent.js';
import type { CodexAdapter, CodexAdapterSettings } from './types.js';

/** A permission mode Codex cannot honour is refused here, before any step is started. */
export const createCodexAdapter = (settings: CodexAdapterSettings): CodexAdapter => {
  permissionArgs(settings.permissionMode, false);
  return { runAgent: runAgentFactory(settings) };
};
