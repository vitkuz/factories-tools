import { describe, expect, it } from 'vitest';
import { withoutRun } from '../src/features/runs/hooks/use-runs-feed';
import type { DashboardData, RemoveRunOutcome, RunRecord } from '../src/features/runs/runs.types';
import { removeFailureOf, removedNotice } from '../src/features/runs/runs.utils';

const record = (pipelineId: string, runId: string): RunRecord =>
  ({ pipelineId, runId, hasState: false, state: null, cost: null }) as unknown as RunRecord;

const data: DashboardData = {
  generatedAt: '2026-10-24T00:00:00.000Z',
  pipelines: {},
  runs: [record('a', 'r1'), record('a', 'r2'), record('b', 'r1')],
};

describe('remove a run', () => {
  it('drops exactly the removed run from the data on screen', () => {
    const next: DashboardData = withoutRun(data, { pipelineId: 'a', runId: 'r1' });
    expect(next.runs.map((r: RunRecord): string => `${r.pipelineId}/${r.runId}`)).toEqual([
      'a/r2',
      'b/r1',
    ]);
    expect(withoutRun(data, { pipelineId: 'c', runId: 'r1' })).toBe(data);
  });

  it('a 409 is a live session, with the API message as the line to show', () => {
    const outcome: RemoveRunOutcome = removeFailureOf({
      kind: 'http',
      status: 409,
      message: 'the run is still live in session "factory-x-1" — stop the session first',
      details: { session: 'factory-x-1' },
    });
    expect(outcome).toEqual({
      ok: false,
      live: true,
      message: 'the run is still live in session "factory-x-1" — stop the session first',
    });
    expect(removeFailureOf({ kind: 'network', message: 'down' })).toEqual({
      ok: false,
      live: false,
      message: 'down',
    });
  });

  it('the notice says where the run went and how to bring it back', () => {
    expect(
      removedNotice({
        pipelineId: 'p',
        runId: 'r1',
        from: 'run/p/r1',
        trashedTo: 'run/.trash/p/r1-20261024T101530123Z',
      }),
    ).toBe(
      'Moved r1 to run/.trash/p/r1-20261024T101530123Z. To restore it, move that folder back to run/p/r1.',
    );
  });
});
