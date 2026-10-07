import path from "node:path";
import type { SourceCursor } from "../contract/adapter.types.js";
import type { ActorFact, Provider, RunFact, UsageEvent } from "../contract/usage-event.types.js";
import type { RunUsageSummary } from "../contract/usage-summary.types.js";
import type { FactoryState } from "../features/factory/factory.types.js";
import {
  appendLines,
  ensureDir,
  fileExists,
  readJsonFile,
  readJsonl,
  writeJsonAtomic,
} from "../shared/utils/fs.utils.js";

export type CustomerRule = { name: string; cwdPrefixes: string[] };

export type FactoryRule = { root: string };

export type UsageConfig = {
  customers: CustomerRule[];
  /** Pipeline factories (dirs with run/<pipeline>/<run>/.state.json) whose runs get per-run cost attribution. */
  factories?: FactoryRule[];
};

export type RunMeta = {
  customer?: string;
  label?: string;
  tags?: Record<string, string>;
};

export type UsageState = {
  schemaVersion: "1";
  updatedAt: string;
  runs: RunUsageSummary[];
};

export type UsageStore = {
  homeDir: string;
  paths: {
    events: string;
    actors: string;
    runs: string;
    checkpoints: string;
    state: string;
    config: string;
    runMeta: string;
    pricingOverrides: string;
    factoryState: string;
  };
  appendEvents: (events: UsageEvent[]) => Promise<{ appended: number; skipped: number }>;
  loadEvents: () => Promise<UsageEvent[]>;
  /** Replaces the whole event log (used by reprice). */
  rewriteEvents: (events: UsageEvent[]) => Promise<void>;
  loadActors: () => Promise<ActorFact[]>;
  saveActors: (facts: ActorFact[]) => Promise<void>;
  loadRuns: () => Promise<RunFact[]>;
  saveRuns: (runs: RunFact[]) => Promise<void>;
  loadCursor: (provider: Provider) => Promise<SourceCursor>;
  saveCursor: (provider: Provider, cursor: SourceCursor) => Promise<void>;
  loadState: () => Promise<UsageState | null>;
  saveState: (state: UsageState) => Promise<void>;
  loadConfig: () => Promise<UsageConfig>;
  saveConfig: (config: UsageConfig) => Promise<void>;
  loadRunMeta: () => Promise<Record<string, RunMeta>>;
  saveRunMeta: (meta: Record<string, RunMeta>) => Promise<void>;
  loadFactoryState: () => Promise<FactoryState | null>;
  saveFactoryState: (state: FactoryState) => Promise<void>;
};

type CheckpointFile = Partial<Record<Provider, SourceCursor>>;

const actorKey = (f: ActorFact): string => `${f.runId}|${f.id}`;

export const createUsageStore = (homeDir: string): UsageStore => {
  const paths: UsageStore["paths"] = {
    events: path.join(homeDir, "events.jsonl"),
    actors: path.join(homeDir, "actors.json"),
    runs: path.join(homeDir, "runs.json"),
    checkpoints: path.join(homeDir, "checkpoints.json"),
    state: path.join(homeDir, "state.json"),
    config: path.join(homeDir, "config.json"),
    runMeta: path.join(homeDir, "run-meta.json"),
    pricingOverrides: path.join(homeDir, "pricing"),
    factoryState: path.join(homeDir, "factory-state.json"),
  };

  const loadEvents = async (): Promise<UsageEvent[]> =>
    (await fileExists(paths.events)) ? readJsonl<UsageEvent>(paths.events) : [];

  const appendEvents: UsageStore["appendEvents"] = async (events: UsageEvent[]) => {
    await ensureDir(homeDir);
    const existing: UsageEvent[] = await loadEvents();
    const known: Set<string> = new Set<string>(existing.map((e: UsageEvent): string => e.eventKey));
    const fresh: UsageEvent[] = events.filter((e: UsageEvent): boolean => {
      if (known.has(e.eventKey)) return false;
      known.add(e.eventKey);
      return true;
    });
    await appendLines(
      paths.events,
      fresh.map((e: UsageEvent): string => JSON.stringify(e)),
    );
    return { appended: fresh.length, skipped: events.length - fresh.length };
  };

  const rewriteEvents = async (events: UsageEvent[]): Promise<void> => {
    await ensureDir(homeDir);
    const tmp: string = `${paths.events}.${process.pid}.tmp`;
    await appendLines(
      tmp,
      events.map((e: UsageEvent): string => JSON.stringify(e)),
    );
    await (await import("node:fs/promises")).rename(tmp, paths.events);
  };

  const loadActors = (): Promise<ActorFact[]> => readJsonFile<ActorFact[]>(paths.actors, []);
  const saveActors = async (facts: ActorFact[]): Promise<void> => {
    const merged: Map<string, ActorFact> = new Map<string, ActorFact>();
    (await loadActors()).forEach((f: ActorFact): void => {
      merged.set(actorKey(f), f);
    });
    facts.forEach((f: ActorFact): void => {
      merged.set(actorKey(f), { ...merged.get(actorKey(f)), ...f });
    });
    await writeJsonAtomic(paths.actors, Array.from(merged.values()));
  };

  const loadRuns = (): Promise<RunFact[]> => readJsonFile<RunFact[]>(paths.runs, []);
  const saveRuns = async (runs: RunFact[]): Promise<void> => {
    const merged: Map<string, RunFact> = new Map<string, RunFact>();
    (await loadRuns()).forEach((r: RunFact): void => {
      merged.set(r.runId, r);
    });
    runs.forEach((r: RunFact): void => {
      merged.set(r.runId, { ...merged.get(r.runId), ...r });
    });
    await writeJsonAtomic(paths.runs, Array.from(merged.values()));
  };

  const loadCheckpoints = (): Promise<CheckpointFile> =>
    readJsonFile<CheckpointFile>(paths.checkpoints, {});
  const loadCursor = async (provider: Provider): Promise<SourceCursor> =>
    (await loadCheckpoints())[provider] ?? {};
  const saveCursor = async (provider: Provider, cursor: SourceCursor): Promise<void> => {
    const all: CheckpointFile = await loadCheckpoints();
    await writeJsonAtomic(paths.checkpoints, { ...all, [provider]: cursor });
  };

  return {
    homeDir,
    paths,
    appendEvents,
    loadEvents,
    rewriteEvents,
    loadActors,
    saveActors,
    loadRuns,
    saveRuns,
    loadCursor,
    saveCursor,
    loadState: (): Promise<UsageState | null> => readJsonFile<UsageState | null>(paths.state, null),
    saveState: (state: UsageState): Promise<void> => writeJsonAtomic(paths.state, state),
    loadConfig: (): Promise<UsageConfig> =>
      readJsonFile<UsageConfig>(paths.config, { customers: [] }),
    saveConfig: (config: UsageConfig): Promise<void> => writeJsonAtomic(paths.config, config),
    loadRunMeta: (): Promise<Record<string, RunMeta>> =>
      readJsonFile<Record<string, RunMeta>>(paths.runMeta, {}),
    saveRunMeta: (meta: Record<string, RunMeta>): Promise<void> =>
      writeJsonAtomic(paths.runMeta, meta),
    loadFactoryState: (): Promise<FactoryState | null> =>
      readJsonFile<FactoryState | null>(paths.factoryState, null),
    saveFactoryState: (state: FactoryState): Promise<void> =>
      writeJsonAtomic(paths.factoryState, state),
  };
};
