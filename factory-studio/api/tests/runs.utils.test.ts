import { describe, expect, it } from 'vitest';
import type { PipelineSkill } from '../src/features/pipelines/pipelines.types.js';
import type { RunRecord } from '../src/features/runs/runs.types.js';
import { pipelinesById, sortRuns, statePipelineId } from '../src/features/runs/runs.utils.js';

const run = (runId: string, state: RunRecord['state']): RunRecord => ({
  runId,
  pipelineId: 'p',
  dir: `run/p/${runId}`,
  hasState: state !== null,
  state,
  cost: null,
  hasCost: false,
});

describe('sortRuns', () => {
  it('newest createdAt first, then stateless runs, then by id', () => {
    const input: RunRecord[] = [
      run('b-old', { createdAt: '2026-01-01T00:00:00Z' }),
      run('z-none', null),
      run('a-none', null),
      run('c-new', { createdAt: '2026-09-01T00:00:00Z' }),
      run('d-start', { startAt: '2026-05-01T00:00:00Z' }),
    ];
    expect(sortRuns(input).map((r): string => r.runId)).toEqual([
      'c-new',
      'd-start',
      'b-old',
      'a-none',
      'z-none',
    ]);
    expect(input[0]?.runId).toBe('b-old');
  });
});

describe('statePipelineId', () => {
  it('prefers pipelineName, then pipeline, else null', () => {
    expect(statePipelineId({ pipelineName: 'a-factory', pipeline: 'b-factory' })).toBe('a-factory');
    expect(statePipelineId({ pipeline: 'b-factory' })).toBe('b-factory');
    expect(statePipelineId({})).toBeNull();
    expect(statePipelineId(null)).toBeNull();
  });
});

describe('pipelinesById', () => {
  const skill = (id: string, fileId: string): PipelineSkill => ({
    id,
    dir: `/w/factories/${id}`,
    file: `/w/factories/${id}/pipeline.json`,
    path: `factories/${id}/pipeline.json`,
    pipeline: { id: fileId, steps: {} },
  });

  it('keys by the file id and keeps the first on a duplicate, warning', () => {
    const warnings: string[] = [];
    const result = pipelinesById(
      [
        skill('one-factory', 'one-factory'),
        skill('copy-factory', 'one-factory'),
        skill('two-factory', 'two-factory'),
      ],
      (message: string): void => {
        warnings.push(message);
      },
    );
    expect(Object.keys(result)).toEqual(['one-factory', 'two-factory']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('copy-factory');
  });
});
