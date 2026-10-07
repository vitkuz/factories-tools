import type { ProviderUnit, UsageEvent } from "../contract/usage-event.types.js";
import type { Reconciliation, TokenTotals } from "../contract/usage-summary.types.js";
import { subtractTotals, sumTotals, usageToTotals } from "./totals.js";

/** Latest cumulative snapshot per (thread, model) group, then summed. */
const latestCumulative = (cumulative: UsageEvent[]): UsageEvent[] => {
  const groups: Map<string, UsageEvent> = new Map<string, UsageEvent>();
  cumulative.forEach((event: UsageEvent): void => {
    const key: string = `${event.run.providerThreadId ?? "root"}|${event.model.reported ?? event.model.requested ?? ""}|${event.actor.id ?? ""}`;
    const existing: UsageEvent | undefined = groups.get(key);
    if (!existing || existing.timestamp <= event.timestamp) groups.set(key, event);
  });
  return Array.from(groups.values());
};

const hasTokens = (event: UsageEvent): boolean =>
  event.usage.inputTokens !== undefined || event.usage.outputTokens !== undefined;

const sumUnits = (events: UsageEvent[]): ProviderUnit | undefined => {
  const units: ProviderUnit[] = events.flatMap((e: UsageEvent): ProviderUnit[] =>
    e.billing.providerUnit ? [e.billing.providerUnit] : [],
  );
  const first: ProviderUnit | undefined = units[0];
  if (!first) return undefined;
  return {
    name: first.name,
    amount: units
      .filter((u: ProviderUnit): boolean => u.name === first.name)
      .reduce((acc: number, u: ProviderUnit): number => acc + u.amount, 0),
  };
};

const sumReported = (events: UsageEvent[]): number | undefined => {
  const values: number[] = events.flatMap((e: UsageEvent): number[] =>
    e.billing.reportedCostUsd !== undefined ? [e.billing.reportedCostUsd] : [],
  );
  return values.length === 0
    ? undefined
    : values.reduce((a: number, b: number): number => a + b, 0);
};

/**
 * Compares attributed request-scope usage with the provider's own session totals.
 * Differences are reported explicitly, never folded into the main agent.
 */
export const reconcileUsage = (
  requestEvents: UsageEvent[],
  cumulativeEvents: UsageEvent[],
): Reconciliation => {
  const latest: UsageEvent[] = latestCumulative(cumulativeEvents);
  if (latest.length === 0) return { status: "unavailable" };

  const tokenSnapshots: UsageEvent[] = latest.filter(hasTokens);
  const providerUnit: ProviderUnit | undefined = sumUnits(latest);
  const providerReportedCostUsd: number | undefined = sumReported(latest);
  const attributedUnit: ProviderUnit | undefined = sumUnits(requestEvents);

  const base: Reconciliation = {
    status: "unavailable",
    ...(providerUnit ? { providerUnit } : {}),
    ...(providerReportedCostUsd !== undefined ? { providerReportedCostUsd } : {}),
  };

  if (tokenSnapshots.length > 0) {
    const providerTotals: TokenTotals = sumTotals(
      tokenSnapshots.map((e: UsageEvent): TokenTotals => usageToTotals(e.usage)),
    );
    const attributed: TokenTotals = sumTotals(
      requestEvents.map((e: UsageEvent): TokenTotals => usageToTotals(e.usage)),
    );
    const diff: TokenTotals = subtractTotals(providerTotals, attributed);
    const unitDiff: number | undefined =
      providerUnit && attributedUnit && providerUnit.name === attributedUnit.name
        ? providerUnit.amount - attributedUnit.amount
        : undefined;
    return {
      ...base,
      providerTotals,
      status: diff.totalTokens === 0 && (unitDiff ?? 0) === 0 ? "exact" : "difference",
      unattributedTokens: Math.max(0, diff.totalTokens),
      ...(unitDiff !== undefined && unitDiff !== 0 && providerUnit
        ? { unattributedProviderUnit: { name: providerUnit.name, amount: unitDiff } }
        : {}),
      ...(diff.totalTokens < 0
        ? { note: `attributed usage exceeds provider total by ${-diff.totalTokens} tokens` }
        : {}),
    };
  }

  if (providerUnit && attributedUnit && providerUnit.name === attributedUnit.name) {
    const unitDiff: number = providerUnit.amount - attributedUnit.amount;
    return {
      ...base,
      status: Math.abs(unitDiff) < 1e-9 ? "exact" : "difference",
      ...(Math.abs(unitDiff) >= 1e-9
        ? { unattributedProviderUnit: { name: providerUnit.name, amount: unitDiff } }
        : {}),
      note: "reconciled on provider units; provider exposes no session token total",
    };
  }

  return {
    ...base,
    status: "unavailable",
    note: "provider snapshot has neither tokens nor a comparable unit",
  };
};
