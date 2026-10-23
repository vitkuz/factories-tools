import { describe, expect, it } from 'vitest';
import type { PipelineOverview, RunOverview } from '../src/features/runs/runs.types';
import {
  isAllUnpriced,
  pickPipeline,
  pipelineSummary,
  runsOfPipeline,
  sortByLastRun,
} from '../src/features/runs/runs.utils';

const pipeline = (over: Partial<PipelineOverview>): PipelineOverview => ({
  pipelineId: 'p',
  runs: 1,
  steps: 3,
  costUsd: 1,
  totalTokens: 4_700_000,
  durationSeconds: 60,
  lastRunAt: '2026-10-20T10:00:00Z',
  unpriced: 0,
  ...over,
});

const run = (pipelineId: string, runId: string): RunOverview => ({
  pipelineId,
  runId,
  status: 'completed',
  statusToken: '--st-completed',
  steps: 3,
  stepsCompleted: 3,
  stepsSkipped: 0,
  stepsFailed: 0,
  costUsd: 0.4,
  totalTokens: 100,
  durationSeconds: 60,
  startedAt: '2026-10-20T10:00:00Z',
  priced: true,
  hasState: true,
});

describe('runs home', () => {
  it('sorts pipelines newest last run first, undated last', () => {
    const sorted: PipelineOverview[] = sortByLastRun([
      pipeline({ pipelineId: 'old', lastRunAt: '2026-10-14T10:00:00Z' }),
      pipeline({ pipelineId: 'none', lastRunAt: null }),
      pipeline({ pipelineId: 'new', lastRunAt: '2026-10-20T10:00:00Z' }),
    ]);
    expect(sorted.map((p: PipelineOverview): string => p.pipelineId)).toEqual([
      'new',
      'old',
      'none',
    ]);
  });

  it('picks the wanted pipeline while it is listed, else the first', () => {
    const list: PipelineOverview[] = [pipeline({ pipelineId: 'a' }), pipeline({ pipelineId: 'b' })];
    expect(pickPipeline('b')(list)?.pipelineId).toBe('b');
    expect(pickPipeline('gone')(list)?.pipelineId).toBe('a');
    expect(pickPipeline(null)([])).toBeNull();
  });

  it('keeps the runs of one pipeline in list order', () => {
    const runs: RunOverview[] = [run('a', '1'), run('b', '2'), run('a', '3')];
    expect(runsOfPipeline('a')(runs).map((r: RunOverview): string => r.runId)).toEqual(['1', '3']);
  });

  it('summarises a pipeline row, without tokens when none are known', () => {
    expect(pipelineSummary(pipeline({ runs: 6, steps: 112, totalTokens: 486_600_000 }))).toBe(
      '6 runs · 112 steps · 486.6M tok',
    );
    expect(pipelineSummary(pipeline({ runs: 1, steps: 1, totalTokens: null }))).toBe(
      '1 run · 1 step',
    );
  });

  it('treats a pipeline as unpriced only when every run is', () => {
    expect(isAllUnpriced(pipeline({ runs: 2, unpriced: 2 }))).toBe(true);
    expect(isAllUnpriced(pipeline({ runs: 2, unpriced: 1 }))).toBe(false);
  });
});
