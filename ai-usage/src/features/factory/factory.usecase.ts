import path from "node:path";
import type { ActorFact, RunFact, UsageEvent } from "../../contract/usage-event.types.js";
import {
  readFactoryRuns,
  type PipelineRun,
  type PipelineStep,
} from "../../adapters/factory-state/index.js";
import { writeJsonAtomic } from "../../shared/utils/fs.utils.js";
import type { UsageStore } from "../../storage/usage-store.js";
import { logger } from "../../shared/utils/logger.js";
import { attributeRunCost, sessionKeys } from "./attribute-run-cost.js";
import { PROVIDER_PER_AGENT_USAGE } from "./factory.utils.js";
import type {
  FactoryRunCost,
  FactoryState,
  SessionBundle,
  SessionClaims,
} from "./factory.types.js";

export const COST_SIDECAR = "cost.json";

const under = (project: string | undefined, root: string): boolean => {
  if (!project) return false;
  const r: string = root.replace(/\/+$/, "");
  return project === r || project.startsWith(r + "/");
};

const groupBy = <T>(items: T[], key: (item: T) => string): Map<string, T[]> =>
  items.reduce(
    (m: Map<string, T[]>, item: T): Map<string, T[]> =>
      m.set(key(item), [...(m.get(key(item)) ?? []), item]),
    new Map<string, T[]>(),
  );

/**
 * Which run recorded which provider session id, over every run under one root. The runner writes
 * the id of the session each step ran in, so this is the map from telemetry back to the work.
 */
export const sessionClaims = (runs: PipelineRun[]): SessionClaims =>
  runs.reduce(
    (acc: Map<string, string>, run: PipelineRun): Map<string, string> =>
      run.steps.reduce(
        (inner: Map<string, string>, step: PipelineStep): Map<string, string> =>
          step.sessionIds.reduce(
            (ids: Map<string, string>, id: string): Map<string, string> =>
              ids.has(id) ? ids : ids.set(id, run.runId),
            inner,
          ),
        acc,
      ),
    new Map<string, string>(),
  );

/**
 * All provider sessions whose project lies under the factory root, bundled with their events and
 * actor facts. A session a run claimed is kept whatever its project says: Antigravity records no
 * working directory at all, and the run naming the session is the stronger evidence anyway.
 */
export const bundleSessions = (
  root: string,
  events: UsageEvent[],
  actors: ActorFact[],
  runs: RunFact[],
  claims: SessionClaims = new Map<string, string>(),
): SessionBundle[] => {
  const runById: Map<string, RunFact> = new Map<string, RunFact>(
    runs.map((r): [string, RunFact] => [r.runId, r]),
  );
  const byRun: Map<string, UsageEvent[]> = groupBy(events, (e: UsageEvent): string => e.run.runId);
  const actorsByRun: Map<string, ActorFact[]> = groupBy(actors, (a: ActorFact): string => a.runId);
  return Array.from(byRun.entries())
    .map(([runId, evs]): SessionBundle => ({
      run: runById.get(runId),
      runId,
      provider: evs[0]?.provider ?? "anthropic-claude",
      project: runById.get(runId)?.project ?? evs.find((e) => e.run.project)?.run.project,
      perAgentUsage: PROVIDER_PER_AGENT_USAGE[evs[0]?.provider ?? "anthropic-claude"],
      events: evs,
      actors: actorsByRun.get(runId) ?? [],
    }))
    .filter(
      (b: SessionBundle): boolean =>
        under(b.project, root) || sessionKeys(b).some((key: string): boolean => claims.has(key)),
    );
};

export type RefreshFactoryOptions = {
  store: UsageStore;
  roots: string[];
  writeSidecars: boolean;
};

export const refreshFactoryCosts = async (
  options: RefreshFactoryOptions,
): Promise<FactoryState> => {
  const [events, actors, runs] = await Promise.all([
    options.store.loadEvents(),
    options.store.loadActors(),
    options.store.loadRuns(),
  ]);
  const now: string = new Date().toISOString();
  const all: FactoryRunCost[] = [];
  for (const root of options.roots) {
    const pipelineRuns: PipelineRun[] = await readFactoryRuns(root);
    const claims: SessionClaims = sessionClaims(pipelineRuns);
    const sessions: SessionBundle[] = bundleSessions(root, events, actors, runs, claims);
    for (const run of pipelineRuns) {
      const cost: FactoryRunCost = attributeRunCost(run, sessions, now, claims);
      all.push(cost);
      if (options.writeSidecars) {
        try {
          await writeJsonAtomic(path.join(run.runDir, COST_SIDECAR), cost);
        } catch (error) {
          logger.warn("could not write cost sidecar", {
            runDir: run.runDir,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    logger.debug("factory refreshed", {
      root,
      runs: pipelineRuns.length,
      sessions: sessions.length,
    });
  }
  const state: FactoryState = {
    schemaVersion: "1",
    updatedAt: now,
    roots: options.roots,
    runs: all,
  };
  await options.store.saveFactoryState(state);
  return state;
};
