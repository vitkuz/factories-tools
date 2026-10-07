import type { AgentProfile } from './pipeline.types';

/**
 * Agent types the harness provides. The editor once read agent profiles from disk at build
 * time; the studio app is built without the repository, so the picker offers the built-ins
 * and `custom…` for anything else.
 */
export const BUILTIN_AGENTS: readonly AgentProfile[] = [
  { name: 'general-purpose', description: 'The default subagent: every tool, no special role.' },
  { name: 'human', description: 'Stops the run and asks a person. The prompt is the question.' },
  { name: 'Explore', description: 'Read-only search agent for finding code and files.' },
  { name: 'Plan', description: 'Read-only architect agent that writes implementation plans.' },
  { name: 'claude', description: 'Catch-all agent with every tool.' },
];

export const ALL_AGENTS: readonly AgentProfile[] = BUILTIN_AGENTS;

export const isKnownAgent = (name: string): boolean =>
  ALL_AGENTS.some((agent: AgentProfile): boolean => agent.name === name);
