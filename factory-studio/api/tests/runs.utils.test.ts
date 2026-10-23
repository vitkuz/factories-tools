import { describe, expect, it } from 'vitest';
import type { PipelineSkill } from '../src/features/pipelines/pipelines.types.js';
import type { RunRecord } from '../src/features/runs/runs.types.js';
import {
  TRASH_DIR,
  findSessionRun,
  isRunFolder,
  pipelinesById,
  runSessionId,
  sortRuns,
  statePipelineId,
  trashSegments,
} from '../src/features/runs/runs.utils.js';

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

const STARTED = '2026-10-21T19:49:00.000Z';

const initEntry = (sessionId: string): Record<string, unknown> => ({
  timestamp: '2026-10-21T19:49:26Z',
  type: 'PIPELINE_INIT',
  details: { runId: 'r', sessionId },
});

const opened = (
  runId: string,
  createdAt: string,
  sessionId: string,
  extra: Record<string, unknown> = {},
): RunRecord => ({
  ...run(runId, { createdAt, status: 'RUNNING', history: [initEntry(sessionId)], ...extra }),
  pipelineId: 'ask-factory',
});

describe('runSessionId', () => {
  it("reads the PIPELINE_INIT stamp, prefers the state's own sessionId, else empty", () => {
    expect(runSessionId(opened('a', STARTED, 'claude-1').state)).toBe('claude-1');
    expect(runSessionId(opened('a', STARTED, 'claude-1', { sessionId: 'own' }).state)).toBe('own');
    expect(runSessionId(opened('a', STARTED, '').state)).toBe('');
    expect(runSessionId(null)).toBe('');
    // A history of another shape does not throw: the run just carries no stamp.
    expect(runSessionId({ createdAt: STARTED, history: 'nope' } as RunRecord['state'])).toBe('');
  });
});

describe('findSessionRun', () => {
  const runs: RunRecord[] = [
    opened('mine-old', '2026-10-21T19:50:00.000Z', 'claude-1', { status: 'COMPLETED' }),
    opened('mine-new', '2026-10-21T19:55:00.000Z', 'claude-1'),
    opened('other', '2026-10-21T19:49:30.000Z', 'claude-2'),
    opened('unstamped-late', '2026-10-21T19:52:00.123456789Z', ''),
    opened('unstamped-first', '2026-10-21T19:51:00.123456789Z', ''),
    opened('unstamped-before', '2026-10-21T19:40:00.000Z', ''),
    opened('unstamped-done', '2026-10-21T19:50:30.000Z', '', { status: 'COMPLETED' }),
  ];

  it('takes the run the asking Claude session opened, the newest of several', () => {
    expect(
      findSessionRun(runs, {
        claudeSessionId: 'claude-1',
        factoryId: 'ask-factory',
        startedAt: STARTED,
      }),
    ).toEqual({ pipelineId: 'ask-factory', runId: 'mine-new', match: 'session' });
  });

  it('falls back to the first unfinished unstamped run of the factory since the start', () => {
    expect(
      findSessionRun(runs, {
        claudeSessionId: 'claude-9',
        factoryId: 'ask-factory',
        startedAt: STARTED,
      }),
    ).toEqual({ pipelineId: 'ask-factory', runId: 'unstamped-first', match: 'started-after' });
  });

  it('never gives the fallback a run stamped by another session', () => {
    const stampedOnly: RunRecord[] = runs.filter((r: RunRecord): boolean => r.runId === 'other');
    expect(
      findSessionRun(stampedOnly, {
        claudeSessionId: 'c',
        factoryId: 'ask-factory',
        startedAt: STARTED,
      }),
    ).toBeNull();
  });

  it('finds nothing without a stamp and without studio meta, or for another factory', () => {
    expect(findSessionRun(runs, { claudeSessionId: 'claude-9' })).toBeNull();
    expect(findSessionRun(runs, {})).toBeNull();
    expect(findSessionRun(runs, { factoryId: 'other-factory', startedAt: STARTED })).toBeNull();
    expect(findSessionRun(runs, { factoryId: 'ask-factory', startedAt: 'not a date' })).toBeNull();
  });
});

describe('trash', () => {
  it('a hidden folder under run/ is not a pipeline folder', () => {
    expect(isRunFolder('canonical-factory')).toBe(true);
    expect(isRunFolder(TRASH_DIR)).toBe(false);
    expect(isRunFolder('.anything')).toBe(false);
  });
  it('a removed run lands at .trash/<folder>/<runId>-<stamp>', () => {
    expect(trashSegments('kp-factory', 'run-1', new Date('2026-10-24T10:15:30.123Z'))).toEqual([
      '.trash',
      'kp-factory',
      'run-1-20261024T101530123Z',
    ]);
  });
});
