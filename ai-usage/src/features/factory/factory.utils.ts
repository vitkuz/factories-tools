import type { Provider, UsageEvent } from "../../contract/usage-event.types.js";
import type { TokenTotals } from "../../contract/usage-summary.types.js";
import { addTotals, emptyTotals, usageToTotals } from "../../aggregation/totals.js";
import { addEventCost, emptyCost } from "../../aggregation/aggregate.js";
import type { CostBlock } from "./factory.types.js";

export const emptyBlock = (): CostBlock => ({
  requestCount: 0,
  totals: emptyTotals(),
  providerUnits: [],
  certainty: "unknown",
  unpricedTokens: 0,
});

export const blockFromEvents = (events: UsageEvent[]): CostBlock => {
  const cost = events.reduce(addEventCost, emptyCost());
  const totals: TokenTotals = events.reduce(
    (acc: TokenTotals, e: UsageEvent): TokenTotals => addTotals(acc, usageToTotals(e.usage)),
    emptyTotals(),
  );
  return {
    requestCount: events.length,
    totals,
    ...(cost.estimatedListPriceUsd !== undefined
      ? { estimatedListPriceUsd: cost.estimatedListPriceUsd }
      : {}),
    ...(cost.reportedCostUsd !== undefined ? { reportedCostUsd: cost.reportedCostUsd } : {}),
    ...(cost.billedUsd !== undefined ? { billedUsd: cost.billedUsd } : {}),
    providerUnits: cost.providerUnits,
    certainty: cost.certainty,
    unpricedTokens: cost.unpricedTokens,
  };
};

export const ms = (iso: string | undefined): number => (iso ? new Date(iso).getTime() : NaN);

export const overlapMs = (
  a: { from: number; to: number },
  b: { from: number; to: number },
): number => Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from));

export const within = (t: number, from: number, to: number, slackMs = 0): boolean =>
  t >= from - slackMs && t <= to + slackMs;

export const isAdditive = (e: UsageEvent): boolean =>
  e.usage.scope === "request" || e.usage.scope === "turn";

export const modelsOf = (events: UsageEvent[]): string[] =>
  Array.from(
    new Set<string>(
      events.map((e: UsageEvent): string => e.model.reported ?? e.model.requested ?? "unknown"),
    ),
  );

/** Mirrors each adapter's `capabilities.perAgentUsage`; a provider that cannot name subagents may be linked to a run by time alone. */
export const PROVIDER_PER_AGENT_USAGE: Record<Provider, boolean> = {
  "anthropic-claude": true,
  "openai-codex": true,
  "github-copilot": true,
  "google-antigravity": false,
};
