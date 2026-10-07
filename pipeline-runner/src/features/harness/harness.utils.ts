import path from 'node:path';
import { unique } from '../../shared/utils/fp.utils.js';
import type { ModelAlias, PathAnchors } from '../pipeline/index.js';
import type { AgentHome, Harness, TierMap } from './harness.types.js';

export const DEFAULT_HARNESS: Harness = 'claude';

const inProjectAndHome =
  (projectDir: string[], homeDir: string[], files: (agent: string) => string[]) =>
  (anchors: PathAnchors, agent: string): string[] =>
    [path.join(anchors.rootPath, ...projectDir), path.join(anchors.homePath, ...homeDir)].flatMap(
      (base: string): string[] => files(agent).map((file: string): string => path.join(base, file)),
    );

/**
 * Where a custom agent's profile may live, per harness: the project first, then the user's home.
 * Codex has no custom agents, so nothing is ever found there and general-purpose stands in.
 */
export const AGENT_HOMES: Record<Harness, AgentHome | undefined> = {
  claude: {
    label: '.claude/agents',
    candidates: inProjectAndHome(
      ['.claude', 'agents'],
      ['.claude', 'agents'],
      (agent: string): string[] => [`${agent}.md`],
    ),
  },
  codex: undefined,
  copilot: {
    label: '.github/agents',
    candidates: inProjectAndHome(
      ['.github', 'agents'],
      ['.copilot', 'agents'],
      (agent: string): string[] => [`${agent}.agent.md`, `${agent}.md`],
    ),
  },
  agy: {
    label: '.agents/agents',
    candidates: inProjectAndHome(
      ['.agents', 'agents'],
      ['.gemini', 'antigravity-cli', 'agents'],
      (agent: string): string[] => [path.join(agent, 'agent.md'), `${agent}.md`],
    ),
  },
};

export const agentProfileCandidatesFor =
  (harness: Harness) =>
  (anchors: PathAnchors, agent: string): string[] =>
    AGENT_HOMES[harness]?.candidates(anchors, agent) ?? [];

/** What a load-time warning says about a custom agent this harness cannot find. */
export const missingProfileReason = (harness: Harness): string => {
  const home: AgentHome | undefined = AGENT_HOMES[harness];
  return home === undefined
    ? `is not available: ${harness} has no custom agents`
    : `has no profile under ${home.label}`;
};

/** The tiers a pipeline names that this harness has no model for — they run on its default. */
export const unmappedTiers = (
  tiers: readonly (ModelAlias | undefined)[],
  models: TierMap,
): ModelAlias[] =>
  unique(
    tiers.filter(
      (tier: ModelAlias | undefined): tier is ModelAlias =>
        tier !== undefined && models[tier] === undefined,
    ),
  );
