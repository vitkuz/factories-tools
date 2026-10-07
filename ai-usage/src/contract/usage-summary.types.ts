import type {
  ActorKind,
  BillingMode,
  CostCertainty,
  Provider,
  ProviderUnit,
} from "./usage-event.types.js";

export type TokenTotals = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

export type CostSummary = {
  providerUnits: ProviderUnit[];
  estimatedListPriceUsd?: number;
  reportedCostUsd?: number;
  billedUsd?: number;
  certainty: CostCertainty;
  /** Tokens for which no rate card was found (cost unknown, never invented). */
  unpricedTokens: number;
  rateCardIds: string[];
};

export type ActorUsageSummary = {
  id: string;
  kind: ActorKind;
  name?: string;
  parentId?: string;
  depth: number;
  requestCount: number;
  models: string[];
  totals: TokenTotals;
  billing: CostSummary;
};

export type ModelUsageSummary = {
  model: string;
  requestCount: number;
  totals: TokenTotals;
  billing: CostSummary;
};

export type ReconciliationStatus = "exact" | "difference" | "unavailable";

export type Reconciliation = {
  status: ReconciliationStatus;
  unattributedTokens?: number;
  unattributedProviderUnit?: ProviderUnit;
  providerTotals?: TokenTotals;
  providerUnit?: ProviderUnit;
  providerReportedCostUsd?: number;
  note?: string;
};

export type RunUsageSummary = {
  runId: string;
  provider: Provider;
  providerSessionId?: string;
  project?: string;
  customer?: string;
  label?: string;
  billingMode: BillingMode;
  startedAt?: string;
  endedAt?: string;
  requestCount: number;
  totals: TokenTotals;
  billing: CostSummary;
  actors: ActorUsageSummary[];
  models: ModelUsageSummary[];
  reconciliation: Reconciliation;
};

export type UsageSnapshot = {
  runId: string;
  provider: Provider;
  capturedAt: string;
  totals?: TokenTotals;
  providerUnit?: ProviderUnit;
  reportedCostUsd?: number;
};
