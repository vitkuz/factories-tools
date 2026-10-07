import type {
  ActorUsageSummary,
  CostSummary,
  RunUsageSummary,
  TokenTotals,
} from "../../contract/usage-summary.types.js";

export const fmtTokens = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(2)}M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(1)}K`
      : String(n);

export const fmtUsd = (n: number | undefined): string =>
  n === undefined ? "unknown" : `$${n.toFixed(4)}`;

export const fmtUnits = (cost: CostSummary): string =>
  cost.providerUnits.length === 0
    ? "-"
    : cost.providerUnits
        .map(
          (u): string =>
            `${u.name === "github_premium_request" ? String(Math.round(u.amount)) : u.amount.toFixed(2)} ${u.name === "github_premium_request" ? "premium req" : u.name}`,
        )
        .join(", ");

export const pad = (s: string, width: number, right = false): string =>
  s.length >= width
    ? s
    : right
      ? " ".repeat(width - s.length) + s
      : s + " ".repeat(width - s.length);

export const shortRunId = (runId: string): string => runId.split(":")[1]?.slice(0, 8) ?? runId;

export const moneyLine = (cost: CostSummary): string => {
  const parts: string[] = [];
  parts.push(`est. list price ${fmtUsd(cost.estimatedListPriceUsd)}`);
  if (cost.reportedCostUsd !== undefined)
    parts.push(`provider estimate ${fmtUsd(cost.reportedCostUsd)}`);
  parts.push(`billed ${cost.billedUsd === undefined ? "unknown" : fmtUsd(cost.billedUsd)}`);
  if (cost.unpricedTokens > 0) parts.push(`unpriced ${fmtTokens(cost.unpricedTokens)} tokens`);
  parts.push(`certainty ${cost.certainty}`);
  return parts.join(" | ");
};

const treeLines = (
  actors: ActorUsageSummary[],
  parentId: string | undefined,
  depth: number,
): string[] => {
  const children: ActorUsageSummary[] = actors.filter((a: ActorUsageSummary): boolean =>
    a.kind === "main" || a.kind === "unattributed"
      ? parentId === undefined
      : (a.parentId ?? "main") === (parentId ?? "main") && depth > 0,
  );
  return children.flatMap((a: ActorUsageSummary): string[] => {
    const label: string =
      a.kind === "main"
        ? "main"
        : a.kind === "unattributed"
          ? "unattributed"
          : `${a.name ?? "agent"} (${a.id.length > 12 ? "…" + a.id.slice(-8) : a.id})`;
    const line: string = `${"  ".repeat(depth)}${depth > 0 ? "└─ " : ""}${pad(label, 44 - depth * 2)} ${pad(fmtTokens(a.totals.totalTokens), 9, true)} tok  ${pad(fmtUsd(a.billing.estimatedListPriceUsd), 10, true)}  ${a.models.join(",")}`;
    const kids: string[] =
      a.kind === "main"
        ? treeLines(actors, a.id, depth + 1)
        : a.kind === "subagent"
          ? treeLines(actors, a.id, depth + 1)
          : [];
    return [line, ...kids];
  });
};

export const formatRunSummary = (run: RunUsageSummary): string => {
  const t: TokenTotals = run.totals;
  const head: string[] = [
    `Run ${run.runId}`,
    `  provider: ${run.provider}   billing mode: ${run.billingMode}   customer: ${run.customer ?? "-"}   project: ${run.project ?? "-"}`,
    `  started: ${run.startedAt ?? "-"}   ended: ${run.endedAt ?? "-"}   requests: ${run.requestCount}`,
    `  tokens: ${fmtTokens(t.totalTokens)} total = ${fmtTokens(t.inputTokens)} in (${fmtTokens(t.cachedInputTokens)} cached, ${fmtTokens(t.cacheWriteTokens)} cache-write) + ${fmtTokens(t.outputTokens)} out (${fmtTokens(t.reasoningTokens)} reasoning)`,
    `  money: ${moneyLine(run.billing)}`,
    `  provider units: ${fmtUnits(run.billing)}`,
    `  reconciliation: ${run.reconciliation.status}${run.reconciliation.unattributedTokens ? ` (${fmtTokens(run.reconciliation.unattributedTokens)} unattributed tokens)` : ""}${run.reconciliation.unattributedProviderUnit ? ` (${run.reconciliation.unattributedProviderUnit.amount.toFixed(2)} unattributed ${run.reconciliation.unattributedProviderUnit.name})` : ""}${run.reconciliation.note ? ` - ${run.reconciliation.note}` : ""}`,
    `  actors:`,
  ];
  const roots: ActorUsageSummary[] = run.actors.filter(
    (a: ActorUsageSummary): boolean => a.kind === "main",
  );
  const rootLines: string[] = roots.flatMap((root: ActorUsageSummary): string[] => {
    const line: string = `    ${pad("main", 44)} ${pad(fmtTokens(root.totals.totalTokens), 9, true)} tok  ${pad(fmtUsd(root.billing.estimatedListPriceUsd), 10, true)}  ${root.models.join(",")}`;
    return [line, ...treeLines(run.actors, root.id, 1).map((l: string): string => `    ${l}`)];
  });
  const orphanLines: string[] = run.actors
    .filter(
      (a: ActorUsageSummary): boolean =>
        a.kind !== "main" &&
        !run.actors.some(
          (p: ActorUsageSummary): boolean =>
            p.id === (a.parentId ?? "main") && p.kind !== "unattributed",
        ),
    )
    .map(
      (a: ActorUsageSummary): string =>
        `    ${pad(`${a.kind}: ${a.name ?? a.id}`, 44)} ${pad(fmtTokens(a.totals.totalTokens), 9, true)} tok  ${pad(fmtUsd(a.billing.estimatedListPriceUsd), 10, true)}  ${a.models.join(",")}`,
    );
  const modelLines: string[] = [
    "  models:",
    ...run.models.map(
      (m): string =>
        `    ${pad(m.model, 44)} ${pad(fmtTokens(m.totals.totalTokens), 9, true)} tok  ${pad(fmtUsd(m.billing.estimatedListPriceUsd), 10, true)}  ${m.requestCount} req`,
    ),
  ];
  return [...head, ...rootLines, ...orphanLines, ...modelLines].join("\n");
};

export const formatRunsTable = (runs: RunUsageSummary[]): string => {
  const header: string = `${pad("started", 20)} ${pad("provider", 17)} ${pad("customer", 14)} ${pad("run", 10)} ${pad("tokens", 9, true)} ${pad("est. USD", 10, true)} ${pad("units", 22)} ${pad("recon", 11)} project`;
  const rows: string[] = runs.map(
    (r: RunUsageSummary): string =>
      `${pad((r.startedAt ?? "").slice(0, 19).replace("T", " "), 20)} ${pad(r.provider, 17)} ${pad(r.customer ?? "-", 14)} ${pad(shortRunId(r.runId), 10)} ${pad(fmtTokens(r.totals.totalTokens), 9, true)} ${pad(fmtUsd(r.billing.estimatedListPriceUsd), 10, true)} ${pad(fmtUnits(r.billing), 22)} ${pad(r.reconciliation.status, 11)} ${r.project ?? "-"}`,
  );
  return [header, ...rows].join("\n");
};

export type GroupTotals = {
  key: string;
  runs: number;
  totals: TokenTotals;
  estimatedListPriceUsd?: number;
  units: string;
};

export const formatGroupTable = (title: string, groups: GroupTotals[]): string => {
  const header: string = `${pad(title, 30)} ${pad("runs", 5, true)} ${pad("tokens", 10, true)} ${pad("est. USD", 11, true)}  units`;
  const rows: string[] = groups.map(
    (g: GroupTotals): string =>
      `${pad(g.key, 30)} ${pad(String(g.runs), 5, true)} ${pad(fmtTokens(g.totals.totalTokens), 10, true)} ${pad(fmtUsd(g.estimatedListPriceUsd), 11, true)}  ${g.units}`,
  );
  return [header, ...rows].join("\n");
};
