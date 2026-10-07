import type { CostCertainty, ProviderUnit, UsageEvent } from "../contract/usage-event.types.js";
import type {
  ActorUsageSummary,
  CostSummary,
  ModelUsageSummary,
  TokenTotals,
} from "../contract/usage-summary.types.js";
import { eventActorId, type ActorNode } from "./hierarchy.js";
import { addTotals, emptyTotals, usageToTotals } from "./totals.js";

export const emptyCost = (): CostSummary => ({
  providerUnits: [],
  certainty: "unknown",
  unpricedTokens: 0,
  rateCardIds: [],
});

const addUnit = (units: ProviderUnit[], unit: ProviderUnit | undefined): ProviderUnit[] => {
  if (!unit) return units;
  const found: ProviderUnit | undefined = units.find(
    (u: ProviderUnit): boolean => u.name === unit.name,
  );
  return found
    ? units.map((u: ProviderUnit): ProviderUnit =>
        u.name === unit.name ? { name: u.name, amount: u.amount + unit.amount } : u,
      )
    : [...units, { ...unit }];
};

const addOptional = (a: number | undefined, b: number | undefined): number | undefined =>
  a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);

const certaintyRank: Record<CostCertainty, number> = {
  authoritative: 3,
  "provider-estimate": 2,
  "local-estimate": 1,
  unknown: 0,
};

export const deriveCertainty = (cost: CostSummary): CostCertainty =>
  cost.billedUsd !== undefined
    ? "authoritative"
    : cost.reportedCostUsd !== undefined
      ? "provider-estimate"
      : cost.estimatedListPriceUsd !== undefined && cost.unpricedTokens === 0
        ? "local-estimate"
        : "unknown";

export const addEventCost = (cost: CostSummary, event: UsageEvent): CostSummary => {
  const totals: TokenTotals = usageToTotals(event.usage);
  const priced: boolean = event.billing.estimatedListPriceUsd !== undefined;
  const next: CostSummary = {
    providerUnits: (event.billing.extraUnits ?? []).reduce(
      addUnit,
      addUnit(cost.providerUnits, event.billing.providerUnit),
    ),
    ...(addOptional(cost.estimatedListPriceUsd, event.billing.estimatedListPriceUsd) !== undefined
      ? {
          estimatedListPriceUsd: addOptional(
            cost.estimatedListPriceUsd,
            event.billing.estimatedListPriceUsd,
          ),
        }
      : {}),
    ...(addOptional(cost.reportedCostUsd, event.billing.reportedCostUsd) !== undefined
      ? { reportedCostUsd: addOptional(cost.reportedCostUsd, event.billing.reportedCostUsd) }
      : {}),
    ...(addOptional(cost.billedUsd, event.billing.billedUsd) !== undefined
      ? { billedUsd: addOptional(cost.billedUsd, event.billing.billedUsd) }
      : {}),
    certainty: cost.certainty,
    unpricedTokens: cost.unpricedTokens + (priced ? 0 : totals.totalTokens),
    rateCardIds:
      event.billing.rateCardId && !cost.rateCardIds.includes(event.billing.rateCardId)
        ? [...cost.rateCardIds, event.billing.rateCardId]
        : cost.rateCardIds,
  };
  return { ...next, certainty: deriveCertainty(next) };
};

export const mergeCost = (a: CostSummary, b: CostSummary): CostSummary => {
  const merged: CostSummary = {
    providerUnits: b.providerUnits.reduce(addUnit, a.providerUnits),
    ...(addOptional(a.estimatedListPriceUsd, b.estimatedListPriceUsd) !== undefined
      ? { estimatedListPriceUsd: addOptional(a.estimatedListPriceUsd, b.estimatedListPriceUsd) }
      : {}),
    ...(addOptional(a.reportedCostUsd, b.reportedCostUsd) !== undefined
      ? { reportedCostUsd: addOptional(a.reportedCostUsd, b.reportedCostUsd) }
      : {}),
    ...(addOptional(a.billedUsd, b.billedUsd) !== undefined
      ? { billedUsd: addOptional(a.billedUsd, b.billedUsd) }
      : {}),
    certainty: certaintyRank[a.certainty] <= certaintyRank[b.certainty] ? a.certainty : b.certainty,
    unpricedTokens: a.unpricedTokens + b.unpricedTokens,
    rateCardIds: Array.from(new Set<string>([...a.rateCardIds, ...b.rateCardIds])),
  };
  return { ...merged, certainty: deriveCertainty(merged) };
};

const modelOf = (event: UsageEvent): string =>
  event.model.reported ?? event.model.requested ?? "unknown";

/** Aggregates request-scope events per actor, decorated with the actor tree. */
export const aggregateByActor = (events: UsageEvent[], tree: ActorNode[]): ActorUsageSummary[] => {
  const byId: Map<string, ActorUsageSummary> = new Map<string, ActorUsageSummary>();
  tree.forEach((node: ActorNode): void => {
    byId.set(node.id, {
      id: node.id,
      kind: node.kind,
      ...(node.name ? { name: node.name } : {}),
      ...(node.parentId ? { parentId: node.parentId } : {}),
      depth: node.depth,
      requestCount: 0,
      models: [],
      totals: emptyTotals(),
      billing: emptyCost(),
    });
  });
  events.forEach((event: UsageEvent): void => {
    const id: string = eventActorId(event);
    const current: ActorUsageSummary = byId.get(id) ?? {
      id,
      kind: event.actor.kind,
      depth: event.actor.kind === "main" ? 0 : 1,
      requestCount: 0,
      models: [],
      totals: emptyTotals(),
      billing: emptyCost(),
    };
    const model: string = modelOf(event);
    byId.set(id, {
      ...current,
      requestCount: current.requestCount + 1,
      models: current.models.includes(model) ? current.models : [...current.models, model],
      totals: addTotals(current.totals, usageToTotals(event.usage)),
      billing: addEventCost(current.billing, event),
    });
  });
  return Array.from(byId.values());
};

export const aggregateByModel = (events: UsageEvent[]): ModelUsageSummary[] => {
  const byModel: Map<string, ModelUsageSummary> = new Map<string, ModelUsageSummary>();
  events.forEach((event: UsageEvent): void => {
    const model: string = modelOf(event);
    const current: ModelUsageSummary = byModel.get(model) ?? {
      model,
      requestCount: 0,
      totals: emptyTotals(),
      billing: emptyCost(),
    };
    byModel.set(model, {
      ...current,
      requestCount: current.requestCount + 1,
      totals: addTotals(current.totals, usageToTotals(event.usage)),
      billing: addEventCost(current.billing, event),
    });
  });
  return Array.from(byModel.values()).sort(
    (a: ModelUsageSummary, b: ModelUsageSummary): number =>
      b.totals.totalTokens - a.totals.totalTokens,
  );
};
