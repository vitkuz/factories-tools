import { spawn, type ChildProcess } from "node:child_process";
import type { RunUsageSummary } from "../../contract/usage-summary.types.js";
import type { RunMeta, UsageState } from "../../storage/usage-store.js";
import { ingestUsage, rebuildState } from "../ingest/index.js";
import { logger } from "../../shared/utils/logger.js";
import type { RunWrappedResult, RunWrappedSettings } from "./run.types.js";
import { requestCountsByRun, selectTouchedRuns } from "./run.utils.js";

const spawnCommand = (command: string[], cwd: string): Promise<number> =>
  new Promise<number>((resolve, reject): void => {
    const [bin, ...args]: string[] = command;
    if (bin === undefined) {
      reject(new Error("no command given: ai-usage run -- <command> [args...]"));
      return;
    }
    const child: ChildProcess = spawn(bin, args, { cwd, stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("close", (code: number | null, signal: NodeJS.Signals | null): void => {
      resolve(code ?? (signal ? 1 : 0));
    });
  });

/** Tags the runs the command produced with the customer/label the caller asked for. */
const tagRuns = async (
  settings: Pick<RunWrappedSettings, "store" | "customer" | "label">,
  runIds: string[],
): Promise<UsageState | null> => {
  if (runIds.length === 0 || (!settings.customer && !settings.label)) return null;
  const existing: Record<string, RunMeta> = await settings.store.loadRunMeta();
  const meta: Record<string, RunMeta> = runIds.reduce(
    (acc: Record<string, RunMeta>, runId: string): Record<string, RunMeta> => ({
      ...acc,
      [runId]: {
        ...acc[runId],
        ...(settings.customer ? { customer: settings.customer } : {}),
        ...(settings.label ? { label: settings.label } : {}),
      },
    }),
    existing,
  );
  await settings.store.saveRunMeta(meta);
  return rebuildState(settings.store);
};

/**
 * Ingests, runs the command, ingests again, and reports the runs that gained usage in `cwd`
 * meanwhile. Telemetry the harness has not flushed yet simply does not appear — nothing is invented.
 */
export const runWrapped = async (settings: RunWrappedSettings): Promise<RunWrappedResult> => {
  const before: UsageState = (await ingestUsage(settings)).state;
  const baseline: Map<string, number> = requestCountsByRun(before.runs);
  const since: string = new Date().toISOString();

  const exitCode: number = await spawnCommand(settings.command, settings.cwd);

  const after: UsageState = (await ingestUsage(settings)).state;
  const select = selectTouchedRuns({ cwd: settings.cwd, since, baseline });
  const touched: RunUsageSummary[] = select(after.runs);
  logger.debug("wrapped command finished", {
    exitCode,
    touched: touched.length,
    cwd: settings.cwd,
  });

  const runIds: string[] = touched.map((r: RunUsageSummary): string => r.runId);
  const retagged: UsageState | null = await tagRuns(settings, runIds);
  return { exitCode, runs: retagged ? select(retagged.runs) : touched };
};
