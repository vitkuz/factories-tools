import type { CostBlock, FactoryRunCost, StepCost } from "./factory.types.js";
import { fmtTokens, fmtUsd, pad } from "../report/report.utils.js";

const units = (b: CostBlock): string =>
  b.providerUnits.length === 0
    ? "-"
    : b.providerUnits
        .map((u) =>
          u.name === "github_premium_request"
            ? `${Math.round(u.amount)} premium req`
            : `${u.amount.toFixed(2)} ${u.name}`,
        )
        .join(", ");
const dur = (s: number | undefined): string =>
  s === undefined
    ? "-"
    : s >= 3600
      ? `${(s / 3600).toFixed(1)}h`
      : s >= 60
        ? `${Math.round(s / 60)}m`
        : `${s}s`;
const money = (b: CostBlock): string =>
  `${fmtUsd(b.estimatedListPriceUsd)}${b.unpricedTokens > 0 ? "*" : ""}`;

export const formatFactoryRunsTable = (runs: FactoryRunCost[]): string => {
  const header: string = `${pad("started", 17)} ${pad("pipeline", 24)} ${pad("run", 36)} ${pad("status", 10)} ${pad("dur", 6, true)} ${pad("tokens", 9, true)} ${pad("est. USD", 10, true)} ${pad("units", 20)} ${pad("providers", 30)} steps w/ usage`;
  const rows: string[] = runs.map((r: FactoryRunCost): string => {
    const withUsage: number = r.steps.filter((s) => s.cost.requestCount > 0).length;
    const agentSteps: number = r.steps.filter(
      (s) => s.agent !== "human" && s.status !== "skipped" && s.status !== "pending",
    ).length;
    return `${pad((r.startedAt ?? "").slice(0, 16).replace("T", " "), 17)} ${pad(r.pipeline, 24)} ${pad(r.runFolder, 36)} ${pad(r.status, 10)} ${pad(dur(r.durationSeconds), 6, true)} ${pad(fmtTokens(r.totals.totals.totalTokens), 9, true)} ${pad(money(r.totals), 10, true)} ${pad(units(r.totals), 20)} ${pad(r.providers.join(",") || "-", 30)} ${withUsage}/${agentSteps}`;
  });
  return [header, ...rows].join("\n");
};

export const formatFactoryRun = (r: FactoryRunCost): string => {
  const head: string[] = [
    `Run ${r.runId}`,
    `  dir: ${r.runDir}`,
    `  status: ${r.status}   started: ${r.startedAt ?? "-"}   ended: ${r.endedAt ?? "-"}   duration: ${dur(r.durationSeconds)}`,
    `  params: ${JSON.stringify(r.params)}`,
    `  sessions: ${r.sessions.length === 0 ? "none linked" : r.sessions.map((s) => `${s.provider}:${(s.providerSessionId ?? s.sessionRunId).slice(0, 8)} (${s.linkedBy}, ${s.requestCount} req)`).join("; ")}`,
    `  total: ${fmtTokens(r.totals.totals.totalTokens)} tokens · ${money(r.totals)} est. list price · units ${units(r.totals)} · billed ${r.totals.billedUsd === undefined ? "unknown" : fmtUsd(r.totals.billedUsd)} · certainty ${r.totals.certainty}`,
    `  steps:`,
  ];
  const line = (label: string, b: CostBlock, extra: string): string =>
    `    ${pad(label, 46)} ${pad(fmtTokens(b.totals.totalTokens), 9, true)} tok ${pad(money(b), 10, true)} ${pad(units(b), 18)} ${extra}`;
  const stepLines: string[] = r.steps.map((s: StepCost): string => {
    const label: string = `${String(s.order).padStart(2, " ")} ${s.step} · ${s.agent}`;
    const who: string =
      s.actors.length === 0
        ? ""
        : s.actors
            .map((a) => `${a.provider.split("-")[1] ?? a.provider}:${a.name ?? a.id.slice(-6)}`)
            .join(", ");
    return line(
      label,
      s.cost,
      `${pad(s.status, 10)} ${pad(dur(s.durationSeconds), 6, true)}  ${pad(s.attribution, 13)} ${s.models.join(",")}${who ? "  ← " + who : ""}`,
    );
  });
  const tail: string[] = [
    line("   orchestrator (main harness)", r.orchestrator, `${r.orchestrator.requestCount} req`),
    ...(r.unattributed.requestCount > 0
      ? [
          line(
            "   unattributed (in window, no step)",
            r.unattributed,
            `${r.unattributed.requestCount} req`,
          ),
        ]
      : []),
    ...(r.notes.length > 0 ? ["  notes:", ...r.notes.map((n) => `    - ${n}`)] : []),
    ...(r.totals.unpricedTokens > 0
      ? [`  * ${fmtTokens(r.totals.unpricedTokens)} tokens had no rate card and are not priced`]
      : []),
  ];
  return [...head, ...stepLines, ...tail].join("\n");
};
