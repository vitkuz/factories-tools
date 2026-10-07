import type { BillingMode } from "../../contract/usage-event.types.js";

export type ClaudeAdapterSettings = {
  /** ~/.claude */
  homeDir: string;
  billingMode: BillingMode;
  /** Only ingest sessions whose cwd starts with one of these (empty = all). */
  projectFilter?: string[];
};

export type ClaudeRawUsage = {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
  output_tokens_details?: { thinking_tokens?: number };
  cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number };
};

export type ClaudeTranscriptRecord = {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  requestId?: string;
  isSidechain?: boolean;
  agentId?: string | null;
  agentName?: string | null;
  cwd?: string;
  version?: string;
  timestamp?: string;
  message?: {
    id?: string;
    model?: string;
    role?: string;
    content?: unknown;
    usage?: ClaudeRawUsage;
  };
  toolUseResult?: unknown;
};

export type ClaudeAgentLink = {
  agentId: string;
  parentActorId: string;
  name?: string;
  description?: string;
  model?: string;
  startedAt?: string;
  endedAt?: string;
  refs?: string[];
};

export type ClaudeHeadlessResult = {
  type?: string;
  session_id?: string;
  total_cost_usd?: number;
  usage?: ClaudeRawUsage;
  modelUsage?: Record<
    string,
    {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
      thinkingTokens?: number;
      costUSD?: number;
      costBasis?: string;
    }
  >;
  duration_ms?: number;
};
