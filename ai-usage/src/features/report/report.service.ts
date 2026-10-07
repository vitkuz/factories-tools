import type { RunUsageSummary, TokenTotals } from "../../contract/usage-summary.types.js";
import { addTotals, emptyTotals } from "../../aggregation/totals.js";
import { mergeCost, emptyCost } from "../../aggregation/aggregate.js";
import type { CostSummary } from "../../contract/usage-summary.types.js";
import { fmtUnits, type GroupTotals } from "./report.utils.js";

export type ReportFilter = {
  provider?: string;
  customer?: string;
  project?: string;
  since?: string;
  until?: string;
  runId?: string;
};

export const filterRuns =
  (filter: ReportFilter) =>
  (runs: RunUsageSummary[]): RunUsageSummary[] =>
    runs.filter(
      (r: RunUsageSummary): boolean =>
        (!filter.provider || r.provider === filter.provider) &&
        (!filter.customer || r.customer === filter.customer) &&
        (!filter.project || (r.project ?? "").startsWith(filter.project)) &&
        (!filter.since || (r.endedAt ?? r.startedAt ?? "") >= filter.since) &&
        (!filter.until || (r.startedAt ?? "") <= filter.until) &&
        (!filter.runId || r.runId === filter.runId || r.runId.includes(filter.runId)),
    );

export const groupRuns =
  (keyOf: (r: RunUsageSummary) => string) =>
  (runs: RunUsageSummary[]): GroupTotals[] => {
    const groups: Map<string, { runs: number; totals: TokenTotals; cost: CostSummary }> = new Map();
    runs.forEach((r: RunUsageSummary): void => {
      const key: string = keyOf(r);
      const current = groups.get(key) ?? { runs: 0, totals: emptyTotals(), cost: emptyCost() };
      groups.set(key, {
        runs: current.runs + 1,
        totals: addTotals(current.totals, r.totals),
        cost: mergeCost(current.cost, r.billing),
      });
    });
    return Array.from(groups.entries())
      .map(([key, g]): GroupTotals => ({
        key,
        runs: g.runs,
        totals: g.totals,
        ...(g.cost.estimatedListPriceUsd !== undefined
          ? { estimatedListPriceUsd: g.cost.estimatedListPriceUsd }
          : {}),
        units: fmtUnits(g.cost),
      }))
      .sort(
        (a: GroupTotals, b: GroupTotals): number => b.totals.totalTokens - a.totals.totalTokens,
      );
  };

export const byCustomer = groupRuns((r: RunUsageSummary): string => r.customer ?? "(unassigned)");
export const byProvider = groupRuns((r: RunUsageSummary): string => r.provider);
export const byProject = groupRuns((r: RunUsageSummary): string => r.project ?? "(unknown)");
export const byDay = groupRuns(
  (r: RunUsageSummary): string => (r.startedAt ?? "").slice(0, 10) || "(unknown)",
);
