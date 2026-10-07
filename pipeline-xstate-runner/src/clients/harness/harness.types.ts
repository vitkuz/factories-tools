// Learned from factories-tools/pipeline-runner/src/features/run/run.types.ts (AgentPort, AgentRequest, AgentResult)
export type Scalar = string | number | boolean;

/** Values a step reported alongside its event: only scalars can take part in a condition. */
export type Reported = Record<string, Scalar>;

export interface AgentRequest {
  stepName: string;
  prompt: string;
  systemPrompt?: string;
  /** The tier pipeline.json names (`fable`, `opus`, `sonnet`, `haiku`); absent means the default. */
  model?: string;
  /** A custom agent profile, already known to exist. Absent means general-purpose. */
  agentProfile?: string;
  /** The repository root: project settings, agents and MCP servers hang off it. */
  cwd: string;
  /** The run folder; a harness that must hand its binary a file keeps it under here. */
  runDir: string;
  /** The keys of the step's `transitions`. The answer must be one of them. */
  allowedEvents: readonly string[];
  /** Continue this session instead of opening a new one — how a wrong answer is asked again. */
  resumeSessionId?: string;
}

/** What a harness reports instead of dollars. Every field is a sum, so two of these add up. */
export interface AgentUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  premiumRequests?: number;
}

export interface AgentResult {
  /** Undefined when the agent finished without naming an event at all. */
  event?: string;
  reported: Reported;
  text: string;
  sessionId?: string;
  transcriptPath?: string;
  /** Only a harness that reports dollars sets this. Absent never means free. */
  costUsd?: number;
  usage?: AgentUsage;
  durationMs?: number;
}

/** What a harness can do natively. What it lacks is bridged inside its client, or refused. */
export interface HarnessCapabilities {
  systemPrompt: boolean;
  structuredOutput: boolean;
  resume: boolean;
  customAgents: boolean;
  costUsd: boolean;
  permissionModes: readonly string[];
}

/** THE PLUG-IN POINT: one headless subagent per call. `signal` aborts it (timeout, Ctrl-C). */
export interface HarnessClient {
  name: string;
  capabilities: HarnessCapabilities;
  runStep: (request: AgentRequest) => (signal: AbortSignal) => Promise<AgentResult>;
}
