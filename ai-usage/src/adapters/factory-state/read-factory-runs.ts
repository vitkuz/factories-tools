import fsp from "node:fs/promises";
import path from "node:path";
import { fileExists } from "../../shared/utils/fs.utils.js";
import { asNumber, asString, isRecord } from "../adapter.utils.js";
import type { PipelineRun, PipelineStep } from "./factory-state.types.js";

const STATE_FILES: string[] = [".state.json", "state.json"];

const toIso = (value: unknown): string | undefined => {
  const s: string | undefined = asString(value);
  if (!s) return undefined;
  const d: Date = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

const seconds = (from: string | undefined, to: string | undefined): number | undefined =>
  from && to ? Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000) : undefined;

/**
 * A step's session id per pass. The step record keeps only the latest pass, so the run history is
 * read too: a looped step ran in one session per pass and every one of them is that step's work.
 */
const sessionIdsByStep = (raw: Record<string, unknown>): Map<string, string[]> => {
  const history: unknown[] = Array.isArray(raw.history) ? raw.history : [];
  return history.reduce((acc: Map<string, string[]>, entry: unknown): Map<string, string[]> => {
    if (!isRecord(entry)) return acc;
    const step: string | undefined = asString(entry.step);
    const id: string | undefined = isRecord(entry.details)
      ? asString(entry.details.sessionId)
      : undefined;
    return step && id ? acc.set(step, [...(acc.get(step) ?? []), id]) : acc;
  }, new Map<string, string[]>());
};

const normalizeStep = (
  name: string,
  raw: Record<string, unknown>,
  fallbackOrder: number,
  fromHistory: string[],
): PipelineStep => {
  const startedAt: string | undefined = toIso(raw.startedAt ?? raw.startAt);
  const endedAt: string | undefined = toIso(raw.completedAt ?? raw.endAt);
  const history: unknown[] = Array.isArray(raw.history) ? raw.history : [];
  const windows: Array<{ from: string; to: string }> = history.flatMap(
    (h: unknown): Array<{ from: string; to: string }> => {
      if (!isRecord(h)) return [];
      const from: string | undefined = toIso(h.startAt ?? h.startedAt);
      const to: string | undefined = toIso(h.endAt ?? h.completedAt);
      return from && to ? [{ from, to }] : [];
    },
  );
  const outputs: string[] = Array.isArray(raw.outputs)
    ? raw.outputs.filter((o: unknown): o is string => typeof o === "string")
    : [];
  return {
    name,
    order: asNumber(raw.order ?? raw.index) ?? fallbackOrder,
    agent: asString(raw.agent) ?? "unknown",
    status: (asString(raw.status) ?? "unknown").toLowerCase(),
    passes: asNumber(raw.passes) ?? (startedAt ? 1 : 0),
    ...(startedAt ? { startedAt } : {}),
    ...(endedAt ? { endedAt } : {}),
    ...(asNumber(raw.durationSeconds) !== undefined
      ? { durationSeconds: asNumber(raw.durationSeconds) }
      : seconds(startedAt, endedAt) !== undefined
        ? { durationSeconds: seconds(startedAt, endedAt) }
        : {}),
    outputs,
    sessionIds: Array.from(
      new Set<string>([
        ...(asString(raw.sessionId) ? [asString(raw.sessionId) as string] : []),
        ...fromHistory,
      ]),
    ),
    windows:
      windows.length > 0 ? windows : startedAt && endedAt ? [{ from: startedAt, to: endedAt }] : [],
  };
};

export const parsePipelineState = (
  raw: unknown,
  ctx: { root: string; runDir: string; stateFile: string },
): PipelineRun | null => {
  if (!isRecord(raw) || !isRecord(raw.steps)) return null;
  const pipeline: string =
    asString(raw.pipelineName ?? raw.pipeline) ?? path.basename(path.dirname(ctx.runDir));
  const runFolder: string = path.basename(ctx.runDir);
  const historyIds: Map<string, string[]> = sessionIdsByStep(raw);
  const steps: PipelineStep[] = Object.entries(raw.steps)
    .map(([name, step], i): PipelineStep | null =>
      isRecord(step) ? normalizeStep(name, step, i + 1, historyIds.get(name) ?? []) : null,
    )
    .filter((s): s is PipelineStep => s !== null)
    .sort((a: PipelineStep, b: PipelineStep): number => a.order - b.order);
  const stepStarts: string[] = steps
    .flatMap((s: PipelineStep): string[] => (s.startedAt ? [s.startedAt] : []))
    .sort();
  const stepEnds: string[] = steps
    .flatMap((s: PipelineStep): string[] => (s.endedAt ? [s.endedAt] : []))
    .sort();
  const startedAt: string | undefined = toIso(raw.startAt ?? raw.createdAt) ?? stepStarts[0];
  const endedAt: string | undefined =
    toIso(raw.endAt ?? raw.updatedAt) ?? stepEnds[stepEnds.length - 1];
  const params: Record<string, unknown> = isRecord(raw.params)
    ? raw.params
    : isRecord(raw.context) && isRecord(raw.context.params)
      ? raw.context.params
      : {};
  return {
    runId: `${pipeline}/${runFolder}`,
    pipeline,
    runDir: ctx.runDir,
    runFolder,
    root: ctx.root,
    status: (asString(raw.status) ?? "unknown").toLowerCase(),
    ...(startedAt ? { startedAt } : {}),
    ...(endedAt ? { endedAt } : {}),
    ...(asNumber(raw.durationSeconds) !== undefined
      ? { durationSeconds: asNumber(raw.durationSeconds) }
      : seconds(startedAt, endedAt) !== undefined
        ? { durationSeconds: seconds(startedAt, endedAt) }
        : {}),
    params,
    steps,
    stateFile: ctx.stateFile,
  };
};

/** Discovers `<root>/run/<pipeline>/<run>/(.state.json|state.json)` and parses each. */
export const readFactoryRuns = async (root: string, runDirName = "run"): Promise<PipelineRun[]> => {
  const base: string = path.join(root, runDirName);
  if (!(await fileExists(base))) return [];
  const pipelines: string[] = (await fsp.readdir(base, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const runs: PipelineRun[] = [];
  for (const pipeline of pipelines) {
    const pdir: string = path.join(base, pipeline);
    const folders: string[] = (await fsp.readdir(pdir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const folder of folders) {
      const runDir: string = path.join(pdir, folder);
      for (const name of STATE_FILES) {
        const stateFile: string = path.join(runDir, name);
        if (!(await fileExists(stateFile))) continue;
        try {
          const parsed: PipelineRun | null = parsePipelineState(
            JSON.parse(await fsp.readFile(stateFile, "utf8")),
            { root, runDir, stateFile },
          );
          if (parsed) runs.push(parsed);
        } catch {
          // unreadable state file: skip, the factory owns it
        }
        break;
      }
    }
  }
  return runs.sort((a: PipelineRun, b: PipelineRun): number =>
    (b.startedAt ?? "").localeCompare(a.startedAt ?? ""),
  );
};
