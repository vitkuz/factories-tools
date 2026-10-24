import { describe, expect, it } from 'vitest';
import type { RunsFeed } from '../src/features/runs/hooks/use-runs-feed';
import type { DashboardData, Pipeline, RunRecord } from '../src/features/runs/runs.types';
import type { Workspace, WorkspaceOption } from '../src/features/workspaces/workspaces.types';
import { workspacePayloadSchema } from '../src/features/workspaces/workspaces.schema';
import {
  describeFactoryCount,
  factoryOptions,
  filterFeed,
  filterRuns,
  inWorkspace,
  pickWorkspace,
  withWorkspace,
  withoutWorkspace,
} from '../src/features/workspaces/workspaces.utils';

const record = (pipelineId: string, runId: string): RunRecord =>
  ({ pipelineId, runId, hasState: false, state: null, cost: null }) as unknown as RunRecord;

const pipeline = (id: string): Pipeline => ({ id, START: [], steps: {} }) as unknown as Pipeline;

const data: DashboardData = {
  generatedAt: '2026-10-24T10:00:00Z',
  pipelines: { alpha: pipeline('alpha'), beta: pipeline('beta'), gamma: pipeline('gamma') },
  runs: [record('alpha', 'a1'), record('beta', 'b1'), record('alpha', 'a2'), record('gone', 'g1')],
};

const feed: RunsFeed = {
  data,
  source: 'live',
  updatedAt: 0,
  settled: true,
  refreshing: false,
  error: null,
  invalid: false,
  invalidIssues: [],
  dropped: [],
  refresh: (): void => undefined,
  forget: (): void => undefined,
};

const ws = (id: string, pipelines: string[], name: string = id): Workspace => ({
  id,
  name,
  pipelines,
});

const keys = (runs: RunRecord[]): string[] =>
  runs.map((r: RunRecord): string => `${r.pipelineId}/${r.runId}`);

describe('inWorkspace', () => {
  it('lets every factory through for All', () => {
    expect(inWorkspace(null)('anything')).toBe(true);
  });

  it('keeps only the workspace ids', () => {
    const keep: (id: string) => boolean = inWorkspace(ws('w', ['alpha']));
    expect(keep('alpha')).toBe(true);
    expect(keep('beta')).toBe(false);
  });
});

describe('filterRuns', () => {
  it('returns the same array for All', () => {
    expect(filterRuns(null)(data.runs)).toBe(data.runs);
  });

  it('keeps the runs of the workspace factories, in order', () => {
    expect(keys(filterRuns(ws('w', ['alpha', 'gone']))(data.runs))).toEqual([
      'alpha/a1',
      'alpha/a2',
      'gone/g1',
    ]);
  });
});

describe('filterFeed', () => {
  it('returns the very same feed for All', () => {
    expect(filterFeed(null)(feed)).toBe(feed);
  });

  it('filters the runs and narrows the pipelines record', () => {
    const shown: RunsFeed = filterFeed(ws('w', ['beta', 'gamma', 'missing']))(feed);
    expect(keys(shown.data.runs)).toEqual(['beta/b1']);
    expect(Object.keys(shown.data.pipelines).sort()).toEqual(['beta', 'gamma']);
    expect(shown.data.pipelines.beta).toBe(data.pipelines.beta);
    expect(shown.data.generatedAt).toBe(data.generatedAt);
    expect(shown.refresh).toBe(feed.refresh);
    expect(shown.forget).toBe(feed.forget);
    expect(feed.data.runs).toHaveLength(4);
  });

  it('gives an empty list for a workspace with no factories', () => {
    const shown: RunsFeed = filterFeed(ws('w', []))(feed);
    expect(shown.data.runs).toEqual([]);
    expect(shown.data.pipelines).toEqual({});
  });
});

describe('pickWorkspace', () => {
  const list: Workspace[] = [ws('a', ['alpha']), ws('b', ['beta'])];

  it('finds the wanted one', () => {
    expect(pickWorkspace('b')(list)).toBe(list[1]);
  });

  it('falls back to All when nothing is wanted or the id is not listed', () => {
    expect(pickWorkspace(null)(list)).toBeNull();
    expect(pickWorkspace('gone')(list)).toBeNull();
    expect(pickWorkspace('a')([])).toBeNull();
  });
});

describe('factoryOptions', () => {
  it('unions the pipelines on disk and the ones runs name, sorted', () => {
    expect(factoryOptions(null, data)).toEqual<WorkspaceOption[]>([
      { id: 'alpha', onDisk: true },
      { id: 'beta', onDisk: true },
      { id: 'gamma', onDisk: true },
      { id: 'gone', onDisk: false },
    ]);
  });

  it('adds the workspace own ids, flagging the ones not on disk', () => {
    const options: WorkspaceOption[] = factoryOptions(ws('w', ['zeta', 'alpha']), data);
    expect(options.map((o: WorkspaceOption): string => o.id)).toEqual([
      'alpha',
      'beta',
      'gamma',
      'gone',
      'zeta',
    ]);
    expect(options.find((o: WorkspaceOption): boolean => o.id === 'zeta')?.onDisk).toBe(false);
  });
});

describe('list helpers', () => {
  it('replaces a workspace by id or appends a new one', () => {
    const list: Workspace[] = [ws('a', []), ws('b', [])];
    expect(withWorkspace(ws('b', ['x'], 'B'))(list)).toEqual([ws('a', []), ws('b', ['x'], 'B')]);
    expect(withWorkspace(ws('c', []))(list).map((w: Workspace): string => w.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(withoutWorkspace('a')(list)).toEqual([ws('b', [])]);
  });

  it('counts factories in words', () => {
    expect(describeFactoryCount(ws('a', []))).toBe('no factories');
    expect(describeFactoryCount(ws('a', ['x']))).toBe('1 factory');
    expect(describeFactoryCount(ws('a', ['x', 'y']))).toBe('2 factories');
  });
});

describe('workspacePayloadSchema', () => {
  it('trims the name and refuses an empty or long one', () => {
    expect(workspacePayloadSchema.parse({ name: '  Klevrs ', pipelines: [] }).name).toBe('Klevrs');
    expect(workspacePayloadSchema.safeParse({ name: '   ', pipelines: [] }).success).toBe(false);
    expect(workspacePayloadSchema.safeParse({ name: 'x'.repeat(81), pipelines: [] }).success).toBe(
      false,
    );
  });
});
