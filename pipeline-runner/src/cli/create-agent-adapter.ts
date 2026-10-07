import { createAgyAdapter } from '../adapters/agy/index.js';
import type { HarnessAdapterSettings, ScratchSettings } from '../adapters/agent-shared/index.js';
import { createClaudeAdapter } from '../adapters/claude/index.js';
import { createCodexAdapter } from '../adapters/codex/index.js';
import { createCopilotAdapter } from '../adapters/copilot/index.js';
import type { Harness, TierMap } from '../features/harness/index.js';
import type { AgentPort } from '../features/run/index.js';

/** Everything any harness adapter may need; each factory below picks what its adapter takes. */
export interface AgentAdapterSettings
  extends Omit<HarnessAdapterSettings, 'bin' | 'models'>, ScratchSettings {
  bins: Record<Harness, string>;
  models: Record<Harness, TierMap>;
  /** Where Claude Code keeps transcripts. */
  homePath: string;
}

const FACTORIES: Record<
  Harness,
  (settings: HarnessAdapterSettings & ScratchSettings & { homePath: string }) => AgentPort
> = {
  claude: createClaudeAdapter,
  codex: createCodexAdapter,
  copilot: createCopilotAdapter,
  agy: createAgyAdapter,
};

/**
 * One harness name in, one AgentPort out. Throws — before any step starts — when the permission
 * mode has no equivalent on that harness.
 */
export const createAgentAdapter = (harness: Harness, settings: AgentAdapterSettings): AgentPort => {
  const { bins, models, ...shared }: AgentAdapterSettings = settings;
  return FACTORIES[harness]({ ...shared, bin: bins[harness], models: models[harness] });
};
