import type { BillingMode } from "../../contract/usage-event.types.js";
import type { SqliteQuery } from "../sqlite/python-sqlite.adapter.js";

export type CopilotAdapterSettings = {
  /** ~/.copilot */
  homeDir: string;
  billingMode: BillingMode;
  pythonBin: string;
  projectFilter?: string[];
  /** Injected for tests; defaults to a python-backed reader on session-store.db. */
  query?: SqliteQuery;
};

export type CopilotUsageRow = {
  id: number;
  session_id: string;
  turn_index: number | null;
  agent_id: string | null;
  parent_tool_call_id: string | null;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  total_nano_aiu: number | null;
  request_multiplier: number | null;
  initiator: string | null;
  api_endpoint: string | null;
  reasoning_effort: string | null;
  created_at: string | null;
};

export type CopilotSessionRow = {
  id: string;
  cwd: string | null;
  repository: string | null;
  created_at: string | null;
};

export type CopilotSessionEvent = {
  type?: string;
  id?: string;
  timestamp?: string;
  agentId?: string | null;
  data?: Record<string, unknown>;
};

export type CopilotSubagentInfo = {
  toolCallId: string;
  /** Copilot ≥1.0.8x: the UUID used as agent_id in usage rows; older versions reuse the toolCallId. */
  agentId?: string;
  description?: string;
  refs?: string[];
  agentName?: string;
  agentDisplayName?: string;
  model?: string;
  startedAt?: string;
  endedAt?: string;
  totalTokens?: number;
};
