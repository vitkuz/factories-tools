import type { AdapterReadResult, UsageAdapter } from "../../contract/adapter.types.js";
import type { ResolveRateCard } from "../../contract/rate-card.types.js";
import type { ActorFact, RunFact, UsageEvent } from "../../contract/usage-event.types.js";
import type { RunUsageSummary } from "../../contract/usage-summary.types.js";
import { buildRunUsageSummary, priceUsageEvents } from "../../aggregation/index.js";
import type { RunMeta, UsageState, UsageStore } from "../../storage/usage-store.js";
import { resolveCustomer } from "../customers/customers.service.js";
import { logger } from "../../shared/utils/logger.js";
import { refreshFactoryCosts } from "../factory/factory.usecase.js";

export type IngestSettings = {
  store: UsageStore;
  adapters: UsageAdapter[];
  resolveRateCard: ResolveRateCard;
};

export type IngestResult = {
  appended: number;
  skipped: number;
  perProvider: Record<string, { read: number; appended: number }>;
  state: UsageState;
};

const groupBy = <T>(items: T[], key: (item: T) => string): Map<string, T[]> =>
  items.reduce((map: Map<string, T[]>, item: T): Map<string, T[]> => {
    const k: string = key(item);
    map.set(k, [...(map.get(k) ?? []), item]);
    return map;
  }, new Map<string, T[]>());

/** Rebuilds state.json from the immutable event log + facts. Pure over the store contents. */
export const rebuildState = async (store: UsageStore): Promise<UsageState> => {
  const [events, actors, runs, config, runMeta] = await Promise.all([
    store.loadEvents(),
    store.loadActors(),
    store.loadRuns(),
    store.loadConfig(),
    store.loadRunMeta(),
  ]);
  const customerOf = resolveCustomer(config);
  const eventsByRun: Map<string, UsageEvent[]> = groupBy(
    events,
    (e: UsageEvent): string => e.run.runId,
  );
  const actorsByRun: Map<string, ActorFact[]> = groupBy(actors, (a: ActorFact): string => a.runId);
  const runById: Map<string, RunFact> = new Map<string, RunFact>(
    runs.map((r: RunFact): [string, RunFact] => [r.runId, r]),
  );
  const runIds: string[] = Array.from(new Set<string>([...eventsByRun.keys(), ...runById.keys()]));

  const summaries: RunUsageSummary[] = runIds
    .map((runId: string): RunUsageSummary => {
      const run: RunFact | undefined = runById.get(runId);
      const meta: RunMeta | undefined = runMeta[runId];
      const customer: string | undefined =
        meta?.customer ?? customerOf(run?.project ?? eventsByRun.get(runId)?.[0]?.run.project);
      return buildRunUsageSummary({
        runId,
        events: eventsByRun.get(runId) ?? [],
        actors: actorsByRun.get(runId) ?? [],
        ...(run ? { run } : {}),
        ...(customer ? { customer } : {}),
        ...(meta?.label ? { label: meta.label } : {}),
      });
    })
    .filter(
      (s: RunUsageSummary): boolean =>
        s.requestCount > 0 || s.reconciliation.status !== "unavailable",
    )
    .sort((a: RunUsageSummary, b: RunUsageSummary): number =>
      (b.startedAt ?? "").localeCompare(a.startedAt ?? ""),
    );

  const state: UsageState = {
    schemaVersion: "1",
    updatedAt: new Date().toISOString(),
    runs: summaries,
  };
  await store.saveState(state);
  return state;
};

/** Recomputes list-price estimates for every stored event from the current rate cards, then rebuilds state. */
export const repriceUsage = async (
  settings: Pick<IngestSettings, "store" | "resolveRateCard">,
): Promise<UsageState> => {
  const events: UsageEvent[] = await settings.store.loadEvents();
  const cleared: UsageEvent[] = events.map((e: UsageEvent): UsageEvent => {
    const { estimatedListPriceUsd: _p, rateCardId: _r, ...billing } = e.billing;
    return {
      ...e,
      billing: {
        ...billing,
        certainty:
          billing.reportedCostUsd !== undefined || billing.billedUsd !== undefined
            ? billing.certainty
            : "unknown",
      },
    };
  });
  const priced: UsageEvent[] = await priceUsageEvents(settings.resolveRateCard)(cleared);
  await settings.store.rewriteEvents(priced);
  return rebuildState(settings.store);
};

export const ingestUsage = async (settings: IngestSettings): Promise<IngestResult> => {
  const price = priceUsageEvents(settings.resolveRateCard);
  const perProvider: Record<string, { read: number; appended: number }> = {};
  const totals = { appended: 0, skipped: 0 };

  for (const adapter of settings.adapters) {
    const cursor = await settings.store.loadCursor(adapter.provider);
    const result: AdapterReadResult = await adapter.read(cursor);
    const priced: UsageEvent[] = await price(result.events);
    // Order matters for crash safety: events (idempotent) -> facts -> cursor.
    const appended = await settings.store.appendEvents(priced);
    await settings.store.saveActors(result.actors);
    await settings.store.saveRuns(result.runs);
    await settings.store.saveCursor(adapter.provider, result.cursor);
    perProvider[adapter.provider] = { read: result.events.length, appended: appended.appended };
    totals.appended += appended.appended;
    totals.skipped += appended.skipped;
    logger.debug("ingested", {
      provider: adapter.provider,
      read: result.events.length,
      appended: appended.appended,
    });
  }

  const state: UsageState = await rebuildState(settings.store);
  const config = await settings.store.loadConfig();
  const roots: string[] = (config.factories ?? []).map((f) => f.root);
  if (roots.length > 0)
    await refreshFactoryCosts({ store: settings.store, roots, writeSidecars: true });
  return { ...totals, perProvider, state };
};
