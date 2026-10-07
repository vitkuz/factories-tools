import path from "node:path";
import type { RunUsageSummary } from "../../contract/usage-summary.types.js";

/** requestCount per run before the command ran; the baseline touched runs are measured against. */
export const requestCountsByRun = (runs: RunUsageSummary[]): Map<string, number> =>
  new Map<string, number>(
    runs.map((r: RunUsageSummary): [string, number] => [r.runId, r.requestCount]),
  );

const insideCwd = (project: string | undefined, cwd: string): boolean =>
  project !== undefined && (project === cwd || project.startsWith(cwd + path.sep));

/**
 * A run belongs to the command when it gained requests during the window and either ran in `cwd`
 * or reported no directory at all but started inside the window. Never guesses beyond that.
 */
export const selectTouchedRuns =
  (settings: { cwd: string; since: string; baseline: Map<string, number> }) =>
  (runs: RunUsageSummary[]): RunUsageSummary[] =>
    runs.filter((run: RunUsageSummary): boolean => {
      const before: number = settings.baseline.get(run.runId) ?? 0;
      if (run.requestCount <= before) return false;
      if (run.project !== undefined) return insideCwd(run.project, settings.cwd);
      return (run.endedAt ?? run.startedAt ?? "") >= settings.since;
    });
