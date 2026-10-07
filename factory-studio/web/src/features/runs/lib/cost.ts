/**
 * Pure helpers over a run's cost.json (see dashboard.schema.ts `costSchema`). Everything
 * here is curried like graph.ts and tolerates a missing cost (null) so callers can
 * compose without guarding.
 *
 * The file records cost per **step**, not per attempt: a step that ran three times carries
 * one bucket covering all three, plus the agents (`actors`) and models it used. Nothing
 * here invents a split the file does not have.
 */
import { formatTokens } from './format';
import type { Cost, CostBucket, CostStep, RunState, UsageTotals } from './types';

const EMPTY_BUCKET: CostBucket = {
  requestCount: 0,
  estimatedListPriceUsd: 0,
  providerUnits: [],
};

/** The step's entry in `cost.steps`; null when the run has no cost or the step is not in it. */
export const stepCost =
  (cost: Cost | null | undefined) =>
  (stepId: string): CostStep | null =>
    cost?.steps.find((s: CostStep) => s.step === stepId) ?? null;

/** True once an agent actually billed something against the step. */
const billed = (step: CostStep | null): boolean => (step?.cost.requestCount ?? 0) > 0;

/** The step's money alone — what a card footer prints; null when no agent ran for it. */
export const stepCostUSD =
  (cost: Cost | null | undefined) =>
  (stepId: string): number | null => {
    const step: CostStep | null = stepCost(cost)(stepId);
    return billed(step) ? (step?.cost.estimatedListPriceUsd ?? null) : null;
  };

/** cost.json was generated before the state last moved (a step finished after factory-cost ran). */
export const isCostStale = (cost: Cost, state: RunState | null): boolean => {
  if (!state) return false;
  const generated: number = Date.parse(cost.generatedAt);
  const updated: number = Date.parse(state.updatedAt);
  return Number.isFinite(generated) && Number.isFinite(updated) && generated < updated;
};

/** Fraction of the run total (0–1); null when the step has no cost or the total is zero. */
export const costShare =
  (cost: Cost | null | undefined) =>
  (stepId: string): number | null => {
    const total: number = cost?.totals.estimatedListPriceUsd ?? 0;
    const usd: number | null = stepCostUSD(cost)(stepId);
    return usd !== null && total > 0 ? usd / total : null;
  };

const addUsage = (a: UsageTotals | undefined, b: UsageTotals | undefined): UsageTotals => ({
  inputTokens: (a?.inputTokens ?? 0) + (b?.inputTokens ?? 0),
  cachedInputTokens: (a?.cachedInputTokens ?? 0) + (b?.cachedInputTokens ?? 0),
  cacheWriteTokens: (a?.cacheWriteTokens ?? 0) + (b?.cacheWriteTokens ?? 0),
  outputTokens: (a?.outputTokens ?? 0) + (b?.outputTokens ?? 0),
  reasoningTokens: (a?.reasoningTokens ?? 0) + (b?.reasoningTokens ?? 0),
  totalTokens: (a?.totalTokens ?? 0) + (b?.totalTokens ?? 0),
});

const addBuckets = (a: CostBucket, b: CostBucket): CostBucket => ({
  requestCount: a.requestCount + b.requestCount,
  estimatedListPriceUsd: a.estimatedListPriceUsd + b.estimatedListPriceUsd,
  totals: addUsage(a.totals, b.totals),
  providerUnits: a.providerUnits,
  certainty: a.certainty,
});

/**
 * Cost per model, most expensive first — for the run breakdown. A step records which models
 * it used but not how its tokens split between them, so a step that used several is listed
 * under one combined key: the totals stay right and the label stays honest about its scope.
 */
export const modelsByCost = (cost: Cost): Array<[string, CostBucket]> =>
  [
    ...cost.steps
      .filter((step: CostStep) => billed(step))
      .reduce((acc: Map<string, CostBucket>, step: CostStep): Map<string, CostBucket> => {
        const key: string = step.models.length > 0 ? step.models.join(' + ') : 'unattributed';
        const seen: CostBucket | undefined = acc.get(key);
        return new Map(acc).set(key, seen ? addBuckets(seen, step.cost) : step.cost);
      }, new Map<string, CostBucket>())
      .entries(),
  ].sort(([, a], [, b]) => b.estimatedListPriceUsd - a.estimatedListPriceUsd);

/** What the driving conversation itself cost, outside any step. */
export const orchestratorCost = (cost: Cost): CostBucket => cost.orchestrator ?? EMPTY_BUCKET;

/** Spend the report could not tie to any step (0 when none). */
export const unaccountedUSD = (cost: Cost): number => cost.unattributed?.estimatedListPriceUsd ?? 0;

/** "12.3k in · 67.9k out · 55.0M cached"; null when no counter is present. */
export const tokenSummary = (tokens: UsageTotals | undefined): string | null => {
  if (!tokens) return null;
  // `inputTokens` is inclusive: it counts cache reads and cache writes as well as fresh input.
  const fresh: number = Math.max(
    0,
    tokens.inputTokens - tokens.cachedInputTokens - tokens.cacheWriteTokens,
  );
  const parts: string[] = [
    `${formatTokens(fresh)} in`,
    `${formatTokens(tokens.outputTokens)} out`,
    `${formatTokens(tokens.cachedInputTokens)} cached`,
  ];
  return parts.join(' · ');
};

/** How much of the money is a local estimate rather than something the provider reported. */
export const costCertainty = (cost: Cost): string | null => cost.totals.certainty ?? null;

/** The model the step ran transitions: the first one the report recorded. Null without cost data. */
export const stepModel =
  (cost: Cost | null | undefined) =>
  (stepId: string): string | null =>
    stepCost(cost)(stepId)?.models[0] ?? null;

/** Agents the step spawned beyond its own — 0 when it worked alone. */
export const stepNestedAgents =
  (cost: Cost | null | undefined) =>
  (stepId: string): number =>
    Math.max(0, (stepCost(cost)(stepId)?.actors.length ?? 0) - 1);

/** `claude-fable-5-1` → `fable-5-1`, `claude-haiku-4-5-20251001` → `haiku-4-5` — fits a card line. */
export const shortModel = (model: string): string =>
  model
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .replace(/\[[^\]]*\]$/, '');
