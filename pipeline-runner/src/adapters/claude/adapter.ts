import { runAgentFactory } from './operations/run-agent.js';
import type { ClaudeAdapter, ClaudeAdapterSettings } from './types.js';

export const createClaudeAdapter = (settings: ClaudeAdapterSettings): ClaudeAdapter => ({
  runAgent: runAgentFactory(settings),
});
