import { describe, expect, it } from 'vitest';
import { costSchema, runStateSchema } from '../src/features/runs/lib/dashboard.schema';
import type { Cost, Pipeline, RunRecord, RunState } from '../src/features/runs/lib/types';
import {
  OTHER_ROW,
  breakdownAddsUp,
  modelFamily,
  stepBreakdownOf,
  stepSharesOf,
  stepsTimeSum,
} from '../src/features/runs/runs-breakdown.utils';
import { runOverviewOf } from '../src/features/runs/runs.utils';
import type { StepBreakdown, StepShare, StepUsageRow } from '../src/features/runs/runs.types';

const NOW: number = Date.parse('2026-10-20T12:00:00Z');

const bucket = (tokens: number, usd: number | undefined, requests: number = 1): unknown => ({
  requestCount: requests,
  totals: {
    inputTokens: tokens,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: tokens,
  },
  ...(usd === undefined
    ? { unpricedTokens: tokens, certainty: 'unknown' }
    : { estimatedListPriceUsd: usd }),
  providerUnits: [],
});

const cost: Cost = costSchema.parse({
  schemaVersion: '1',
  generatedAt: '2026-10-20T11:30:00Z',
  runId: 'r',
  pipeline: 'p',
  totals: bucket(1000, 1.0, 10),
  orchestrator: bucket(300, 0.4, 3),
  unattributed: bucket(50, undefined, 1),
  steps: [
    { step: 'b', passes: 1, durationSeconds: 70, models: ['m'], cost: bucket(400, 0.5, 4) },
    { step: 'a', passes: 2, durationSeconds: 100, models: ['m'], cost: bucket(250, 0.1, 2) },
    // Counted but never priced.
    { step: 'c', passes: 1, models: ['m'], cost: bucket(0, undefined, 0) },
  ],
});

const state: RunState = runStateSchema.parse({
  runId: 'r',
  pipelineName: 'p',
  status: 'RUNNING',
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-20T11:00:00Z',
  steps: {
    a: {
      status: 'COMPLETED',
      startedAt: '2026-10-20T10:00:00Z',
      completedAt: '2026-10-20T10:03:00Z',
      passes: 2,
      history: [
        { pass: 1, startAt: '2026-10-20T10:00:00Z', endAt: '2026-10-20T10:01:00Z' },
        { pass: 2, startAt: '2026-10-20T10:02:00Z', endAt: '2026-10-20T10:03:00Z' },
      ],
    },
    b: { status: 'RUNNING', startedAt: '2026-10-20T11:00:00Z', passes: 1 },
    c: { status: 'SKIPPED', skipReason: 'routed around' },
    d: { status: 'PENDING' },
  },
});

const pipeline: Pipeline = {
  id: 'p',
  START: ['a'],
  steps: { d: {}, c: {}, b: {}, a: {} },
} as unknown as Pipeline;

const record = (overrides: Partial<RunRecord> = {}): RunRecord =>
  ({
    runId: 'r',
    pipelineId: 'p',
    dir: 'run/p/r',
    hasState: true,
    state,
    cost,
    hasCost: true,
    ...overrides,
  }) as RunRecord;

const names = (rows: readonly StepUsageRow[]): string[] =>
  rows.map((r: StepUsageRow): string => r.step);

describe('stepBreakdownOf', () => {
  it('orders the steps by start, unstarted after in the pipeline order, and merges cost with state', () => {
    const b: StepBreakdown = stepBreakdownOf(record(), pipeline, NOW);
    expect(names(b.steps)).toEqual(['a', 'b', 'd', 'c']);
    const [a, bRow, d, c]: StepUsageRow[] = b.steps;
    expect(a).toMatchObject({
      passes: 2,
      tokens: 250,
      costUsd: 0.1,
      durationSeconds: 120,
      status: 'COMPLETED',
    });
    // An open pass counts to now: 11:00 → 12:00.
    expect(bRow).toMatchObject({ passes: 1, tokens: 400, costUsd: 0.5, durationSeconds: 3600 });
    expect(d).toMatchObject({ passes: null, tokens: null, costUsd: null, durationSeconds: null });
    expect(c).toMatchObject({ passes: null, tokens: null, costUsd: null, status: 'SKIPPED' });
  });

  it('puts what the steps do not account for on the other line, and the total equals the run row', () => {
    const run: RunRecord = record();
    const b: StepBreakdown = stepBreakdownOf(run, pipeline, NOW);
    expect(b.other).toMatchObject({ step: OTHER_ROW, tokens: 350 });
    expect(b.other?.costUsd).toBeCloseTo(0.4, 6);
    expect(b.total).toMatchObject({ step: 'Total', tokens: 1000, costUsd: 1.0, passes: 3 });
    expect(breakdownAddsUp(b)).toBe(true);
    const row = runOverviewOf(run, NOW);
    expect(b.total.tokens).toBe(row.totalTokens);
    expect(b.total.costUsd).toBe(row.costUsd);
  });

  it('shows unpriced for a step whose tokens were counted but never priced', () => {
    const priced: Cost = costSchema.parse({
      ...cost,
      steps: [{ step: 'a', passes: 1, models: [], cost: bucket(250, undefined, 2) }],
    });
    const b: StepBreakdown = stepBreakdownOf(record({ cost: priced }), pipeline, NOW);
    expect(b.steps.find((r: StepUsageRow): boolean => r.step === 'a')?.costUsd).toBe('unpriced');
  });

  it('a run without cost.json has passes and times but no tokens, no cost, no other line', () => {
    const b: StepBreakdown = stepBreakdownOf(record({ cost: null, hasCost: false }), pipeline, NOW);
    expect(b.priced).toBe(false);
    expect(b.other).toBeNull();
    expect(b.total).toMatchObject({ tokens: null, costUsd: null, passes: 3 });
    expect(b.steps[0]).toMatchObject({ step: 'a', durationSeconds: 120, tokens: null });
    expect(breakdownAddsUp(b)).toBe(true);
  });

  it('a run without state falls back to the report for passes and duration', () => {
    const b: StepBreakdown = stepBreakdownOf(record({ state: null, hasState: false }), null, NOW);
    expect(names(b.steps)).toEqual(['b', 'a', 'c']);
    expect(b.steps[1]).toMatchObject({ step: 'a', passes: 2, durationSeconds: 100 });
  });

  it('no other line when the steps account for everything', () => {
    const exact: Cost = costSchema.parse({
      ...cost,
      totals: bucket(650, 0.6, 6),
      orchestrator: undefined,
      unattributed: undefined,
    });
    expect(stepBreakdownOf(record({ cost: exact }), pipeline, NOW).other).toBeNull();
  });
});

describe('stepSharesOf', () => {
  it('draws each line as its share of the run, the costliest full, half of it or more hot', () => {
    const b: StepBreakdown = stepBreakdownOf(record(), pipeline, NOW);
    const shares: StepShare[] = stepSharesOf(b);
    expect(shares.map((s: StepShare): string => s.row.step)).toEqual([
      'a',
      'b',
      'd',
      'c',
      OTHER_ROW,
    ]);
    const [a, bRow, d, , other]: StepShare[] = shares;
    expect(a?.share).toBeCloseTo(0.1, 6);
    expect(a?.barPct).toBeCloseTo(20, 6);
    expect(a?.hot).toBe(false);
    expect(bRow).toMatchObject({ barPct: 100, hot: true });
    expect(other?.barPct).toBeCloseTo(80, 6);
    expect(other?.hot).toBe(true);
    expect(d).toMatchObject({ share: null, barPct: 0, hot: false });
  });

  it('adds up the steps working time', () => {
    expect(stepsTimeSum(stepBreakdownOf(record(), pipeline, NOW))).toBe(3720);
  });
});

describe('models per row', () => {
  const modelBucket = (
    tokens: number,
    usd: number,
    byModel: Array<[string, number, number]>,
  ): unknown => ({
    ...(bucket(tokens, usd, byModel.length) as object),
    byModel: byModel.map(([model, t, u]) => ({
      model,
      requestCount: 1,
      totals: { totalTokens: t },
      estimatedListPriceUsd: u,
    })),
  });
  const withModels: Cost = costSchema.parse({
    schemaVersion: '1',
    generatedAt: '2026-10-20T11:30:00Z',
    runId: 'r',
    pipeline: 'p',
    totals: modelBucket(1000, 1.0, [
      ['claude-opus-5-5', 700, 0.8],
      ['claude-sonnet-5-5', 300, 0.2],
    ]),
    orchestrator: modelBucket(300, 0.4, [['claude-opus-5-5', 300, 0.4]]),
    unattributed: modelBucket(50, 0.05, [['claude-sonnet-5-5', 50, 0.05]]),
    steps: [
      {
        step: 'a',
        passes: 1,
        models: ['claude-sonnet-5-5', 'claude-opus-5-5'],
        cost: modelBucket(650, 0.55, [
          ['claude-sonnet-5-5', 250, 0.15],
          ['claude-opus-5-5', 400, 0.4],
        ]),
      },
      // An older report: the step names its models but has no per-model figures.
      { step: 'b', passes: 1, models: ['claude-haiku-5-5'], cost: bucket(10, 0.01, 1) },
      { step: 'c', passes: 1, models: [], cost: bucket(0, undefined, 0) },
    ],
  });

  it('lists each row’s models most tokens first, from the report’s per-model records', () => {
    const b: StepBreakdown = stepBreakdownOf(record({ cost: withModels }), pipeline, NOW);
    const row = (n: string): StepUsageRow => b.steps.find((r) => r.step === n)!;
    expect(row('a').models).toEqual([
      { model: 'claude-opus-5-5', tokens: 400, costUsd: 0.4 },
      { model: 'claude-sonnet-5-5', tokens: 250, costUsd: 0.15 },
    ]);
    expect(row('b').models).toEqual([{ model: 'claude-haiku-5-5', tokens: 0, costUsd: null }]);
    expect(row('c').models).toEqual([]);
    // the other line merges the orchestrator and the unattributed calls
    expect(b.other?.models).toEqual([
      { model: 'claude-opus-5-5', tokens: 300, costUsd: 0.4 },
      { model: 'claude-sonnet-5-5', tokens: 50, costUsd: 0.05 },
    ]);
    expect(b.total.models.map((m) => m.model)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5']);
  });

  it('names the model family for the column', () => {
    expect(modelFamily('claude-opus-5-5')).toBe('opus');
    expect(modelFamily('claude-haiku-4-5-20251001')).toBe('haiku');
    expect(modelFamily('claude-fable-5-1')).toBe('fable');
    expect(modelFamily('gpt-5')).toBe('gpt-5');
  });

  it('a report without per-model records still adds up and shows no models for unbilled rows', () => {
    const b: StepBreakdown = stepBreakdownOf(record(), pipeline, NOW);
    expect(breakdownAddsUp(b)).toBe(true);
    expect(b.steps.find((r) => r.step === 'd')?.models).toEqual([]);
    expect(b.steps.find((r) => r.step === 'a')?.models).toEqual([
      { model: 'm', tokens: 0, costUsd: null },
    ]);
  });
});
