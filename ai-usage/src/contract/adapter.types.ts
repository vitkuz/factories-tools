import type { ActorFact, Provider, RunFact, UsageEvent } from "./usage-event.types.js";

export type AdapterCapabilities = {
  liveUsage: boolean;
  perAgentUsage: boolean;
  hierarchy: boolean;
  modelUsage: boolean;
  tokenUsage: boolean;
  providerCost: boolean;
  authoritativeCost: boolean;
};

/** Per-source resume position. Keyed by an adapter-defined source id (file path, table name...). */
export type SourceCursorEntry = {
  offset?: number;
  lastRowId?: number;
  state?: Record<string, unknown>;
  updatedAt: string;
};

export type SourceCursor = Record<string, SourceCursorEntry>;

export type AdapterReadResult = {
  events: UsageEvent[];
  actors: ActorFact[];
  runs: RunFact[];
  cursor: SourceCursor;
};

export type UsageAdapter = {
  provider: Provider;
  version: string;
  capabilities: AdapterCapabilities;
  /** Incremental read: everything new since `cursor`. Pure w.r.t. the store; the caller persists the cursor. */
  read: (cursor: SourceCursor) => Promise<AdapterReadResult>;
  /** Convenience streaming form of `read`. */
  stream: (cursor?: SourceCursor) => AsyncIterable<UsageEvent>;
};
