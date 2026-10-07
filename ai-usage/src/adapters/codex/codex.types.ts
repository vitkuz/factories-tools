import type { BillingMode } from "../../contract/usage-event.types.js";

export type CodexAdapterSettings = {
  /** ~/.codex */
  homeDir: string;
  billingMode: BillingMode;
  projectFilter?: string[];
};

export type CodexTokenUsage = {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
};

export type CodexSessionMeta = {
  id?: string;
  timestamp?: string;
  cwd?: string;
  originator?: string;
  cli_version?: string;
  source?: string;
  parent_thread_id?: string | null;
  forked_from_id?: string | null;
  model_provider?: string | null;
  depth?: number | null;
  nickname?: string | null;
  role?: string | null;
  agent_path?: string | null;
};

export type CodexRolloutLine = {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
};

export type CodexRolloutState = {
  threadId?: string;
  turnId?: string;
  model?: string;
  prevTotal?: number;
  /** Session-cumulative usage reported before this thread emitted its own first request (replayed parent history). */
  baseline?: number;
  lastTotal?: CodexTokenUsage;
  lastTimestamp?: string;
  requestSeq?: number;
};

export type CodexThreadIndexEntry = {
  file: string;
  meta: CodexSessionMeta;
};
