import fsp from "node:fs/promises";
import path from "node:path";
import { fileExists } from "../../shared/utils/fs.utils.js";
import { asNumber, asString, isRecord } from "../adapter.utils.js";
import type { PipelineRun, PipelineStep } from "./factory-state.types.js";

const STATE_FILES: string[] = [".state.json", "state.json"];
/** The pipeline snapshot `hooks.before` copies into the run folder; declares each step's `output` globs. */
const PIPELINE_SNAPSHOT = "pipeline.json";

type Window = { from: string; to: string };

const toIso = (value: unknown): string | undefined => {
  const s: string | undefined = asString(value);
  if (!s) return undefined;
  const d: Date = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

const seconds = (from: string | undefined, to: string | undefined): number | undefined =>
  from && to ? Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000) : undefined;

const historyOf = (raw: Record<string, unknown>): Record<string, unknown>[] =>
  (Array.isArray(raw.history) ? raw.history : []).filter(isRecord);

/**
 * A step's session id per pass. The step record keeps only the latest pass, so the run history is
 * read too: a looped step ran in one session per pass and every one of them is that step's work.
 */
const sessionIdsByStep = (raw: Record<string, unknown>): Map<string, string[]> =>
  historyOf(raw).reduce(
    (acc: Map<string, string[]>, entry: Record<string, unknown>): Map<string, string[]> => {
      const step: string | undefined = asString(entry.step);
      const id: string | undefined = isRecord(entry.details)
        ? asString(entry.details.sessionId)
        : undefined;
      return step && id ? acc.set(step, [...(acc.get(step) ?? []), id]) : acc;
    },
    new Map<string, string[]>(),
  );

/** Session ids recorded for the run as a whole (`PIPELINE_INIT`, or any entry naming no step). */
const runSessionIds = (raw: Record<string, unknown>): string[] =>
  Array.from(
    new Set<string>([
      ...(asString(raw.sessionId) ? [asString(raw.sessionId) as string] : []),
      ...historyOf(raw).flatMap((entry: Record<string, unknown>): string[] => {
        if (asString(entry.step)) return [];
        const id: string | undefined = isRecord(entry.details)
          ? asString(entry.details.sessionId)
          : undefined;
        return id ? [id] : [];
      }),
    ]),
  );

const STEP_OPENERS: Set<string> = new Set<string>(["STEP_START"]);
const STEP_CLOSERS: Set<string> = new Set<string>([
  "STEP_EVENT",
  "STEP_COMPLETE",
  "STEP_FAIL",
  "STEP_SKIP",
  "HUMAN_ANSWER",
]);

/**
 * Every pass window per step, from the run-level history the recorder writes: a `STEP_START`
 * opens a pass, the next step event for the same step closes it. The step record alone keeps only
 * the latest pass, and a looped step's earlier passes are where its earlier subagents ran.
 */
const windowsByStep = (raw: Record<string, unknown>): Map<string, Window[]> => {
  const open: Map<string, string> = new Map<string, string>();
  return historyOf(raw).reduce(
    (acc: Map<string, Window[]>, entry: Record<string, unknown>): Map<string, Window[]> => {
      const step: string | undefined = asString(entry.step);
      const type: string | undefined = asString(entry.type);
      const at: string | undefined = toIso(entry.timestamp);
      if (!step || !type || !at) return acc;
      if (STEP_OPENERS.has(type)) {
        open.set(step, at);
        return acc;
      }
      if (STEP_CLOSERS.has(type)) {
        const from: string | undefined = open.get(step);
        open.delete(step);
        return from ? acc.set(step, [...(acc.get(step) ?? []), { from, to: at }]) : acc;
      }
      return acc;
    },
    new Map<string, Window[]>(),
  );
};

const covered = (windows: Window[], from: string, to: string): boolean =>
  windows.some(
    (w: Window): boolean =>
      new Date(w.from).getTime() <= new Date(from).getTime() + 1000 &&
      new Date(w.to).getTime() >= new Date(to).getTime() - 1000,
  );

/** `7-verify-demo-landing/report-*.md` → `7-verify-demo-landing`; a bare file name has no folder. */
export const topFolderOf = (p: string): string | undefined => {
  const clean: string = p.replace(/^\.\//, "").replace(/^\/+/, "");
  const i: number = clean.indexOf("/");
  return i > 0 ? clean.slice(0, i) : undefined;
};

const folderList = (paths: unknown[]): string[] =>
  Array.from(
    new Set<string>(
      paths
        .filter((o: unknown): o is string => typeof o === "string")
        .map(topFolderOf)
        .filter((f: string | undefined): f is string => f !== undefined && !f.includes("*")),
    ),
  );

/** The `output` globs of each step in the pipeline snapshot, by step id. */
const snapshotOutputs = (pipeline: unknown): Map<string, string[]> => {
  if (!isRecord(pipeline) || !isRecord(pipeline.steps)) return new Map<string, string[]>();
  return Object.entries(pipeline.steps).reduce(
    (acc: Map<string, string[]>, [id, step]: [string, unknown]): Map<string, string[]> =>
      isRecord(step) && Array.isArray(step.output) ? acc.set(id, folderList(step.output)) : acc,
    new Map<string, string[]>(),
  );
};

const normalizeStep = (
  name: string,
  raw: Record<string, unknown>,
  fallbackOrder: number,
  fromHistory: string[],
  passWindows: Window[],
  declaredFolders: string[],
): PipelineStep => {
  const startedAt: string | undefined = toIso(raw.startedAt ?? raw.startAt);
  const endedAt: string | undefined = toIso(raw.completedAt ?? raw.endAt);
  const stepHistory: unknown[] = Array.isArray(raw.history) ? raw.history : [];
  const ownWindows: Window[] = stepHistory.flatMap((h: unknown): Window[] => {
    if (!isRecord(h)) return [];
    const from: string | undefined = toIso(h.startAt ?? h.startedAt);
    const to: string | undefined = toIso(h.endAt ?? h.completedAt);
    return from && to ? [{ from, to }] : [];
  });
  const fromHistoryWindows: Window[] = ownWindows.length > 0 ? ownWindows : passWindows;
  const windows: Window[] =
    startedAt && endedAt && !covered(fromHistoryWindows, startedAt, endedAt)
      ? [...fromHistoryWindows, { from: startedAt, to: endedAt }]
      : fromHistoryWindows;
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
    outputFolders: Array.from(new Set<string>([...folderList(outputs), ...declaredFolders])),
    sessionIds: Array.from(
      new Set<string>([
        ...(asString(raw.sessionId) ? [asString(raw.sessionId) as string] : []),
        ...fromHistory,
      ]),
    ),
    windows: windows.sort((a: Window, b: Window): number => a.from.localeCompare(b.from)),
  };
};

export type ParseStateContext = {
  root: string;
  runDir: string;
  stateFile: string;
  /** The run folder's pipeline.json snapshot, when there is one. */
  pipeline?: unknown;
};

export const parsePipelineState = (raw: unknown, ctx: ParseStateContext): PipelineRun | null => {
  if (!isRecord(raw) || !isRecord(raw.steps)) return null;
  const pipeline: string =
    asString(raw.pipelineName ?? raw.pipeline) ?? path.basename(path.dirname(ctx.runDir));
  const runFolder: string = path.basename(ctx.runDir);
  const historyIds: Map<string, string[]> = sessionIdsByStep(raw);
  const passWindows: Map<string, Window[]> = windowsByStep(raw);
  const declared: Map<string, string[]> = snapshotOutputs(ctx.pipeline);
  const steps: PipelineStep[] = Object.entries(raw.steps)
    .map(([name, step], i): PipelineStep | null =>
      isRecord(step)
        ? normalizeStep(
            name,
            step,
            i + 1,
            historyIds.get(name) ?? [],
            passWindows.get(name) ?? [],
            declared.get(name) ?? [],
          )
        : null,
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
    sessionIds: runSessionIds(raw),
  };
};

const readJsonOrNull = async (file: string): Promise<unknown> => {
  if (!(await fileExists(file))) return undefined;
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return undefined;
  }
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
            {
              root,
              runDir,
              stateFile,
              pipeline: await readJsonOrNull(path.join(runDir, PIPELINE_SNAPSHOT)),
            },
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
