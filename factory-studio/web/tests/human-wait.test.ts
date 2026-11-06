import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../src/features/runs/runs.types';
import { runDurationSeconds } from '../src/features/runs/runs.utils';
import { stepBreakdownOf } from '../src/features/runs/runs-breakdown.utils';

const run: RunRecord = {
  pipelineId: 'p',
  runId: 'r',
  hasState: true,
  cost: null,
  state: {
    status: 'COMPLETED',
    createdAt: '2026-11-01T10:00:00Z',
    updatedAt: '2026-11-01T11:00:00Z',
    steps: {
      work: {
        agent: 'general-purpose',
        status: 'COMPLETED',
        startedAt: '2026-11-01T10:00:00Z',
        completedAt: '2026-11-01T10:10:00Z',
        retryCount: 0,
      },
      gate: {
        agent: 'human',
        status: 'COMPLETED',
        startedAt: '2026-11-01T10:10:00Z',
        completedAt: '2026-11-01T10:50:00Z',
        retryCount: 0,
      },
    },
  },
} as unknown as RunRecord;

describe('human waits', () => {
  it('are left out of the run time', () => {
    expect(runDurationSeconds(run, 0)).toBe(20 * 60);
  });

  it('show as a wait on the gate row, not as working time', () => {
    const gate = stepBreakdownOf(run, null, 0).steps.find((r) => r.step === 'gate');
    expect(gate).toMatchObject({ durationSeconds: null, waitSeconds: 40 * 60 });
  });
});
