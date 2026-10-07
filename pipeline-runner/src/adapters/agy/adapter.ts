import { permissionArgs } from './agy.utils.js';
import { runAgentFactory } from './operations/run-agent.js';
import type { AgyAdapter, AgyAdapterSettings } from './types.js';

/** A permission mode agy cannot honour is refused here, before any step is started. */
export const createAgyAdapter = (settings: AgyAdapterSettings): AgyAdapter => {
  permissionArgs(settings.permissionMode);
  return { runAgent: runAgentFactory(settings) };
};
