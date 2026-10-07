import { permissionArgs } from './copilot.utils.js';
import { runAgentFactory } from './operations/run-agent.js';
import type { CopilotAdapter, CopilotAdapterSettings } from './types.js';

/** A permission mode Copilot cannot honour is refused here, before any step is started. */
export const createCopilotAdapter = (settings: CopilotAdapterSettings): CopilotAdapter => {
  permissionArgs(settings.permissionMode);
  return { runAgent: runAgentFactory(settings) };
};
