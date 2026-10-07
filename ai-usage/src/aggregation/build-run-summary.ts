import type { ActorFact, BillingMode, RunFact, UsageEvent } from "../contract/usage-event.types.js";
import type {
  ActorUsageSummary,
  CostSummary,
  ModelUsageSummary,
  Reconciliation,
  RunUsageSummary,
  TokenTotals,
} from "../contract/usage-summary.types.js";
import {
  addEventCost,
  aggregateByActor,
  aggregateByModel,
  emptyCost,
  mergeCost,
} from "./aggregate.js";
import { deduplicateUsageEvents } from "./deduplicate.js";
import { buildActorTree, UNATTRIBUTED_ACTOR_ID, type ActorNode } from "./hierarchy.js";
import { reconcileUsage } from "./reconcile.js";
import { emptyTotals, sumTotals, usageToTotals } from "./totals.js";

export type BuildRunSummaryInput = {
  runId: string;
  events: UsageEvent[];
  actors: ActorFact[];
  run?: RunFact;
  customer?: string;
  label?: string;
};

const isAdditive = (event: UsageEvent): boolean =>
  event.usage.scope === "request" || event.usage.scope === "turn";

const unattributedActor = (reconciliation: Reconciliation): ActorUsageSummary | null => {
  const tokens: number = reconciliation.unattributedTokens ?? 0;
  const unit = reconciliation.unattributedProviderUnit;
  if (tokens <= 0 && !(unit && unit.amount > 0)) return null;
  const totals: TokenTotals = { ...emptyTotals(), totalTokens: tokens };
  return {
    id: UNATTRIBUTED_ACTOR_ID,
    kind: "unattributed",
    depth: 0,
    requestCount: 0,
    models: [],
    totals,
    billing: {
      ...emptyCost(),
      providerUnits: unit && unit.amount > 0 ? [unit] : [],
      unpricedTokens: tokens,
    },
  };
};

export const buildRunUsageSummary = (input: BuildRunSummaryInput): RunUsageSummary => {
  const events: UsageEvent[] = deduplicateUsageEvents(input.events);
  const additive: UsageEvent[] = events.filter(isAdditive);
  const cumulative: UsageEvent[] = events.filter(
    (e: UsageEvent): boolean =>
      e.usage.scope === "session-cumulative" || e.usage.scope === "session",
  );

  const tree: ActorNode[] = buildActorTree(input.actors, additive);
  const reconciliation: Reconciliation = reconcileUsage(additive, cumulative);
  const actors: ActorUsageSummary[] = aggregateByActor(additive, tree);
  const extra: ActorUsageSummary | null = unattributedActor(reconciliation);
  const models: ModelUsageSummary[] = aggregateByModel(additive);

  const totals: TokenTotals = sumTotals(
    additive.map((e: UsageEvent): TokenTotals => usageToTotals(e.usage)),
  );
  const attributedCost: CostSummary = additive.reduce(addEventCost, emptyCost());
  const cumulativeCost: CostSummary = {
    ...emptyCost(),
    ...(reconciliation.providerReportedCostUsd !== undefined
      ? { reportedCostUsd: reconciliation.providerReportedCostUsd }
      : {}),
    ...(extra ? { providerUnits: extra.billing.providerUnits } : {}),
  };
  const billing: CostSummary = mergeCost(attributedCost, cumulativeCost);

  const timestamps: string[] = events.map((e: UsageEvent): string => e.timestamp).sort();
  const first: string | undefined = input.run?.startedAt ?? timestamps[0];
  const last: string | undefined = timestamps[timestamps.length - 1];
  const billingMode: BillingMode = input.run?.billingMode ?? events[0]?.billing.mode ?? "unknown";
  const provider = input.run?.provider ?? events[0]?.provider ?? "anthropic-claude";
  const project: string | undefined =
    input.run?.project ??
    events.find((e: UsageEvent): boolean => e.run.project !== undefined)?.run.project;

  return {
    runId: input.runId,
    provider,
    ...(input.run?.providerSessionId ? { providerSessionId: input.run.providerSessionId } : {}),
    ...(project ? { project } : {}),
    ...(input.customer ? { customer: input.customer } : {}),
    ...((input.label ?? input.run?.label) ? { label: input.label ?? input.run?.label } : {}),
    billingMode,
    ...(first ? { startedAt: first } : {}),
    ...(last ? { endedAt: last } : {}),
    requestCount: additive.length,
    totals: extra
      ? { ...totals, totalTokens: totals.totalTokens + extra.totals.totalTokens }
      : totals,
    billing,
    actors: extra ? [...actors, extra] : actors,
    models,
    reconciliation,
  };
};
