import { attemptSpanMs, attemptsOf, workingTimeMs, type Attempt } from './lib/attempts';
import type {
  Cost,
  CostBucket,
  CostStep,
  Pipeline,
  RunRecord,
  RunState,
  StepState,
} from './lib/types';
import type { StepBreakdown, StepModelUsage, StepShare, StepUsageRow } from './runs.types';

/*
 * The per-step breakdown a run row expands into, from the record alone: `cost.json` (tokens and
 * money per step, as ai-usage attributed them) merged with `state.json` (passes and timings).
 * Everything here is pure; the table calls it on first expand and again on every push.
 */

/** The row name for everything the report could not tie to a step: the driving conversation and unattributed calls. */
export const OTHER_ROW = 'other / не по шагам';

const parseMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms: number = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
};

/** How many times the step was entered; `null` when it never started (the state's word first). */
const passesOf = (st: StepState | undefined, cs: CostStep | null): number | null => {
  if (st !== undefined) {
    const started: boolean = Boolean(
      st.startedAt || st.completedAt || (st.history ?? []).length > 0,
    );
    return started ? Math.max(1, st.passes ?? (st.history ?? []).length, st.retryCount + 1) : null;
  }
  return cs?.passes ?? null;
};

/** The step's tokens, once an agent billed something against it. */
const tokensOf = (cs: CostStep | null): number | null =>
  cs !== null && cs.cost.requestCount > 0 ? (cs.cost.totals?.totalTokens ?? null) : null;

/**
 * The step's money: `null` when nothing was billed; `unpriced` when tokens were counted but no
 * price is known for them (the report says so with `unpricedTokens` and no estimate).
 */
const costOf = (cs: CostStep | null): number | 'unpriced' | null => {
  if (cs === null || cs.cost.requestCount === 0) return null;
  const usd: number = cs.cost.estimatedListPriceUsd;
  return usd === 0 && (cs.cost.unpricedTokens ?? 0) > 0 ? 'unpriced' : usd;
};

/**
 * The models of one or more buckets, merged and ordered by tokens (most first). The report records
 * `byModel` per bucket from the usage records; a bucket without it (an older cost.json) yields
 * the step's `models` names with no figures, so the column still names what ran.
 */
export const modelsOf = (
  buckets: readonly (CostBucket | null | undefined)[],
  fallbackNames: readonly string[] = [],
): StepModelUsage[] => {
  const merged: Map<string, StepModelUsage> = new Map();
  for (const bucket of buckets) {
    for (const m of bucket?.byModel ?? []) {
      const seen: StepModelUsage | undefined = merged.get(m.model);
      const usd: number | null =
        m.estimatedListPriceUsd === undefined ? null : m.estimatedListPriceUsd;
      merged.set(m.model, {
        model: m.model,
        tokens: (seen?.tokens ?? 0) + (m.totals?.totalTokens ?? 0),
        costUsd:
          seen?.costUsd === undefined || seen.costUsd === null
            ? usd
            : usd === null
              ? seen.costUsd
              : seen.costUsd + usd,
      });
    }
  }
  if (merged.size === 0) {
    return fallbackNames.map((model: string): StepModelUsage => ({
      model,
      tokens: 0,
      costUsd: null,
    }));
  }
  return [...merged.values()].sort((a: StepModelUsage, b: StepModelUsage) => b.tokens - a.tokens);
};

/** `claude-opus-5-5` → `opus`, `claude-haiku-4-5-20251001` → `haiku`; an unknown id keeps its name. */
export const modelFamily = (model: string): string =>
  /(opus|sonnet|haiku|fable)/.exec(model)?.[1] ?? model.replace(/^claude-/, '');

/** A human gate: its time is waiting for a person, not running time. */
const isHumanRow = (st: StepState | undefined): boolean => st?.agent === 'human';

/** How long a human gate waited for its answers; null for an agent step or one never asked. */
const waitOf = (state: RunState | null, slug: string, now: number): number | null => {
  const waits: Attempt[] = attemptsOf(state)(slug).filter(
    (a: Attempt): boolean => a.kind === 'wait',
  );
  if (waits.length === 0) return null;
  return Math.round(
    waits.reduce((t: number, a: Attempt): number => t + (attemptSpanMs(a, now) ?? 0), 0) / 1000,
  );
};

/** Working time from the state's passes; the report's own duration when the state has none; null for a human gate. */
const durationOf = (
  state: RunState | null,
  slug: string,
  cs: CostStep | null,
  now: number,
): number | null => {
  if (isHumanRow(state?.steps[slug])) return null;
  const fromState: number | null =
    state === null ? null : workingTimeMs(attemptsOf(state)(slug), now);
  if (fromState !== null) return Math.round(fromState / 1000);
  return cs?.durationSeconds ?? null;
};

/** When the step first started, for the order of the rows. */
const startedMs = (st: StepState | undefined, cs: CostStep | null): number | null =>
  parseMs(st?.history?.[0]?.startAt) ?? parseMs(st?.startedAt) ?? parseMs(cs?.startedAt);

/**
 * Every step the run knows about: the pipeline's, in its own order, then any the state or the
 * report names that the pipeline does not (an old snapshot, a renamed step).
 */
const stepSlugs = (run: RunRecord, pipeline: Pipeline | null): string[] => {
  const seen: Set<string> = new Set();
  const ordered: string[] = [];
  const add = (slug: string): void => {
    if (seen.has(slug)) return;
    seen.add(slug);
    ordered.push(slug);
  };
  for (const slug of Object.keys(pipeline?.steps ?? {})) add(slug);
  for (const slug of Object.keys(run.state?.steps ?? {})) add(slug);
  for (const step of run.cost?.steps ?? []) add(step.step);
  return ordered;
};

const stepRow =
  (run: RunRecord, now: number) =>
  (slug: string): StepUsageRow => {
    const st: StepState | undefined = run.state?.steps[slug];
    const cs: CostStep | null =
      run.cost?.steps.find((s: CostStep): boolean => s.step === slug) ?? null;
    return {
      step: slug,
      status: st?.status ?? null,
      passes: passesOf(st, cs),
      tokens: tokensOf(cs),
      costUsd: costOf(cs),
      durationSeconds: durationOf(run.state ?? null, slug, cs, now),
      waitSeconds: isHumanRow(st) ? waitOf(run.state ?? null, slug, now) : null,
      startedMs: startedMs(st, cs),
      models: cs !== null && cs.cost.requestCount > 0 ? modelsOf([cs.cost], cs.models) : [],
    };
  };

const sum = (values: readonly (number | null)[]): number | null =>
  values.reduce(
    (total: number | null, v: number | null): number | null =>
      v === null ? total : (total ?? 0) + v,
    null,
  );

const usdOf = (value: number | 'unpriced' | null): number | null =>
  typeof value === 'number' ? value : null;

/**
 * The "other" row: the run's totals less what the steps account for — the orchestrator's own
 * turns, calls the report could not attribute, and rounding. Present only when it is not zero,
 * so the total row always equals the run's own figures.
 */
const otherRow = (cost: Cost, steps: readonly StepUsageRow[]): StepUsageRow | null => {
  const totalTokens: number | null = cost.totals.totals?.totalTokens ?? null;
  const stepTokens: number | null = sum(steps.map((r: StepUsageRow): number | null => r.tokens));
  const tokens: number | null = totalTokens === null ? null : totalTokens - (stepTokens ?? 0);
  const usd: number =
    cost.totals.estimatedListPriceUsd - (sum(steps.map((r) => usdOf(r.costUsd))) ?? 0);
  const roundedUsd: number = Math.abs(usd) < 0.000_001 ? 0 : usd;
  if ((tokens ?? 0) === 0 && roundedUsd === 0) return null;
  return {
    step: OTHER_ROW,
    status: null,
    passes: null,
    tokens,
    costUsd: roundedUsd,
    durationSeconds: null,
    waitSeconds: null,
    startedMs: null,
    models: modelsOf([cost.orchestrator, cost.unattributed]),
  };
};

/**
 * The breakdown of one run: steps in the order they started (unstarted ones after, in the
 * pipeline's order), the "other" line when the report holds usage outside the steps, and the
 * total row carrying the run's own tokens and cost (what the run row shows) and the sum of the
 * passes. Pure.
 */
export const stepBreakdownOf = (
  run: RunRecord,
  pipeline: Pipeline | null,
  now: number,
): StepBreakdown => {
  const order: string[] = stepSlugs(run, pipeline);
  const rows: StepUsageRow[] = order.map(stepRow(run, now));
  const started: StepUsageRow[] = rows
    .filter((r: StepUsageRow): boolean => r.startedMs !== null)
    .sort((a: StepUsageRow, b: StepUsageRow): number => (a.startedMs ?? 0) - (b.startedMs ?? 0));
  const pending: StepUsageRow[] = rows.filter((r: StepUsageRow): boolean => r.startedMs === null);
  const steps: StepUsageRow[] = [...started, ...pending];
  const other: StepUsageRow | null = run.cost ? otherRow(run.cost, steps) : null;
  const totalTokens: number | null = run.cost?.totals.totals?.totalTokens ?? null;
  return {
    steps,
    other,
    total: {
      step: 'Total',
      status: null,
      passes: sum(steps.map((r: StepUsageRow): number | null => r.passes)),
      tokens: totalTokens,
      costUsd: run.cost ? run.cost.totals.estimatedListPriceUsd : null,
      durationSeconds: null,
      waitSeconds: null,
      startedMs: null,
      models: run.cost ? modelsOf([run.cost.totals]) : [],
    },
    priced: run.cost !== null && run.cost !== undefined,
  };
};

/** Σ steps (+ other) equals the total, for tokens and money: the check the test keeps. Pure. */
export const breakdownAddsUp = (breakdown: StepBreakdown): boolean => {
  const rows: StepUsageRow[] = [...breakdown.steps, ...(breakdown.other ? [breakdown.other] : [])];
  const tokens: number | null = sum(rows.map((r: StepUsageRow): number | null => r.tokens));
  const usd: number | null = sum(rows.map((r: StepUsageRow): number | null => usdOf(r.costUsd)));
  const tokensOk: boolean =
    breakdown.total.tokens === null ? tokens === null : (tokens ?? 0) === breakdown.total.tokens;
  const usdOk: boolean =
    breakdown.total.costUsd === null
      ? usd === null
      : Math.abs((usd ?? 0) - usdOf(breakdown.total.costUsd)!) < 0.000_01;
  return tokensOk && usdOk;
};

/** A row at or past this fraction of the costliest row is drawn as one of the costly ones. */
const HOT_FRACTION: number = 0.5;

/**
 * The step lines (and the "other" line last) with their share of the run's money and the bar
 * the panel draws: the costliest row fills the track, rows at half of it or more are hot. Pure.
 */
export const stepSharesOf = (breakdown: StepBreakdown): StepShare[] => {
  const rows: StepUsageRow[] = [...breakdown.steps, ...(breakdown.other ? [breakdown.other] : [])];
  const top: number = Math.max(0, ...rows.map((r: StepUsageRow): number => usdOf(r.costUsd) ?? 0));
  const total: number | null = usdOf(breakdown.total.costUsd);
  return rows.map((row: StepUsageRow): StepShare => {
    const usd: number | null = usdOf(row.costUsd);
    const positive: boolean = usd !== null && usd > 0;
    return {
      row,
      share: positive && total !== null && total > 0 ? usd! / total : null,
      barPct: positive && top > 0 ? Math.min(100, (usd! / top) * 100) : 0,
      hot: positive && top > 0 && usd! >= top * HOT_FRACTION,
    };
  });
};

/** The steps' working time added up (parallel steps overlap, so it can pass the wall time). */
export const stepsTimeSum = (breakdown: StepBreakdown): number | null =>
  sum(breakdown.steps.map((r: StepUsageRow): number | null => r.durationSeconds));
