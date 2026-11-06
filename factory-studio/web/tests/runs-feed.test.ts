import { describe, expect, it } from 'vitest';
import { describeFeed } from '../src/features/runs/components/LiveStatus';
import {
  initialRunsFeedState,
  reduceRunsFeed,
  sortRuns,
  touchesDocument,
  type RunsFeedState,
} from '../src/features/runs/runs-feed.utils';
import type { Pipeline, RunRecord } from '../src/features/runs/runs.types';
import { clientMessageSchema, serverMessageSchema } from '../src/features/sessions/sessions.schema';
import type { ServerMessage } from '../src/features/sessions/sessions.types';
import { mergeSessions } from '../src/features/sessions/hooks/use-sessions';
import type { FactorySession } from '../src/features/sessions/sessions.types';
import { parseSessionList, withLiveAge } from '../src/features/sessions/sessions.utils';

const pipeline = (id: string): Pipeline => ({ id, START: [], steps: {} }) as unknown as Pipeline;

const record = (pipelineId: string, runId: string, createdAt: string | null): unknown => ({
  runId,
  pipelineId,
  dir: `run/${pipelineId}/${runId}`,
  hasState: createdAt !== null,
  state:
    createdAt === null
      ? null
      : {
          runId,
          pipelineName: pipelineId,
          createdAt,
          updatedAt: createdAt,
          status: 'RUNNING',
          steps: {},
        },
  cost: null,
  hasCost: false,
});

const snapshot = (runs: unknown[], pipelines: Record<string, Pipeline> = {}): ServerMessage => ({
  type: 'runs.snapshot',
  generatedAt: '2026-10-31T10:00:00Z',
  pipelines,
  runs,
});

const apply = (state: RunsFeedState, message: ServerMessage): RunsFeedState =>
  reduceRunsFeed(state, { kind: 'message', message });

const ids = (state: RunsFeedState): string[] =>
  state.data.runs.map((r: RunRecord): string => `${r.pipelineId}/${r.runId}`);

const opened: RunsFeedState = reduceRunsFeed(initialRunsFeedState, {
  kind: 'connection',
  state: 'open',
});

describe('reduceRunsFeed', () => {
  it('a snapshot settles the feed, names invalid runs and keeps unchanged objects', () => {
    const first: RunsFeedState = apply(
      opened,
      snapshot([record('a', 'r1', '2026-10-30T10:00:00Z'), { runId: 'bad' }], { a: pipeline('a') }),
    );
    expect(first.settled).toBe(true);
    expect(first.source).toBe('live');
    expect(ids(first)).toEqual(['a/r1']);
    expect(first.dropped).toEqual(['#2']);
    const again: RunsFeedState = apply(
      first,
      snapshot([record('a', 'r1', '2026-10-30T10:00:00Z')], { a: pipeline('a') }),
    );
    expect(again.data.runs[0]).toBe(first.data.runs[0]);
    expect(again.data.pipelines.a).toBe(first.data.pipelines.a);
    expect(again.dropped).toEqual([]);
  });

  it('an invalid snapshot keeps the data on screen and says so', () => {
    const first: RunsFeedState = apply(
      opened,
      snapshot([record('a', 'r1', '2026-10-30T10:00:00Z')]),
    );
    const broken: RunsFeedState = apply(first, {
      type: 'runs.snapshot',
      generatedAt: 'x',
      pipelines: {},
      runs: [{ runId: 'bad' }],
    });
    expect(broken.invalid).toBe(true);
    expect(broken.invalidIssues.length).toBeGreaterThan(0);
    expect(ids(broken)).toEqual(['a/r1']);
  });

  it('run.changed upserts a run in the API order, removes a gone one, names an unreadable one', () => {
    const first: RunsFeedState = apply(
      opened,
      snapshot([
        record('a', 'r2', '2026-10-30T12:00:00Z'),
        record('a', 'r1', '2026-10-30T10:00:00Z'),
      ]),
    );
    const added: RunsFeedState = apply(first, {
      type: 'run.changed',
      folder: 'a',
      runId: 'r3',
      pipelineId: 'a',
      paths: ['state.json'],
      run: record('a', 'r3', '2026-10-30T11:00:00Z'),
    });
    expect(ids(added)).toEqual(['a/r2', 'a/r3', 'a/r1']);
    expect(added.data.runs[0]).toBe(first.data.runs[0]);

    const filesOnly: RunsFeedState = apply(added, {
      type: 'run.changed',
      folder: 'a',
      runId: 'r3',
      paths: ['1-step/out.md'],
    });
    expect(filesOnly).toBe(added);

    const gone: RunsFeedState = apply(added, {
      type: 'run.changed',
      folder: 'a',
      runId: 'r2',
      paths: [''],
      run: null,
      reason: 'gone',
    });
    expect(ids(gone)).toEqual(['a/r3', 'a/r1']);

    const unreadable: RunsFeedState = apply(gone, {
      type: 'run.changed',
      folder: 'a',
      runId: 'r1',
      paths: ['state.json'],
      run: null,
      reason: 'unreadable',
    });
    expect(ids(unreadable)).toEqual(['a/r3']);
    expect(unreadable.dropped).toEqual(['a/r1']);

    const back: RunsFeedState = apply(unreadable, {
      type: 'run.changed',
      folder: 'a',
      runId: 'r1',
      pipelineId: 'a',
      paths: ['state.json'],
      run: record('a', 'r1', '2026-10-30T10:00:00Z'),
    });
    expect(ids(back)).toEqual(['a/r3', 'a/r1']);
    expect(back.dropped).toEqual([]);
  });

  it('a run filed under one folder but declaring another pipeline is replaced, not doubled', () => {
    const first: RunsFeedState = apply(
      opened,
      snapshot([record('legacy', 'r1', '2026-10-30T10:00:00Z')]),
    );
    const moved: RunsFeedState = apply(first, {
      type: 'run.changed',
      folder: 'old-folder',
      runId: 'r1',
      pipelineId: 'legacy',
      paths: ['state.json'],
      run: record('legacy', 'r1', '2026-10-30T10:30:00Z'),
    });
    expect(ids(moved)).toEqual(['legacy/r1']);
    expect(moved.data.runs[0]?.state?.createdAt).toBe('2026-10-30T10:30:00Z');
  });

  it('pipelines.changed swaps the map and keeps unchanged definitions', () => {
    const first: RunsFeedState = apply(
      opened,
      snapshot([], { a: pipeline('a'), b: pipeline('b') }),
    );
    const changed: RunsFeedState = apply(first, {
      type: 'pipelines.changed',
      pipelines: { a: pipeline('a'), c: pipeline('c') },
    });
    expect(Object.keys(changed.data.pipelines).sort()).toEqual(['a', 'c']);
    expect(changed.data.pipelines.a).toBe(first.data.pipelines.a);
  });

  it('a drop keeps the data and unsettles; a reopen waits for the snapshot; forget removes at once', () => {
    const first: RunsFeedState = apply(
      opened,
      snapshot([record('a', 'r1', '2026-10-30T10:00:00Z')]),
    );
    const down: RunsFeedState = reduceRunsFeed(first, { kind: 'connection', state: 'closed' });
    expect(down.source).toBe('unreachable');
    expect(down.settled).toBe(false);
    expect(ids(down)).toEqual(['a/r1']);
    const up: RunsFeedState = reduceRunsFeed(down, { kind: 'connection', state: 'open' });
    expect(up.settled).toBe(false);
    const forgotten: RunsFeedState = reduceRunsFeed(up, {
      kind: 'forget',
      ref: { pipelineId: 'a', runId: 'r1' },
    });
    expect(ids(forgotten)).toEqual([]);
  });
});

describe('sortRuns', () => {
  it('newest first, stateful before stateless, then by id', () => {
    const runs: RunRecord[] = [
      record('a', 'z', null),
      record('a', 'old', '2026-01-01T00:00:00Z'),
      record('a', 'b', null),
      record('a', 'new', '2026-02-01T00:00:00Z'),
    ] as RunRecord[];
    expect(sortRuns(runs).map((r: RunRecord): string => r.runId)).toEqual(['new', 'old', 'b', 'z']);
    expect(runs.map((r: RunRecord): string => r.runId)).toEqual(['z', 'old', 'b', 'new']);
  });
});

describe('describeFeed', () => {
  const base = { settled: true, source: 'live' as const, invalid: false, dropped: [] };
  it('reads the socket first, then the snapshot, and never says when', () => {
    const live = describeFeed({ ...base, connection: 'open' });
    expect(live.word).toBe('Live');
    expect(live.title).not.toMatch(/ago|updated/i);
    expect(describeFeed({ ...base, connection: 'closed' })).toMatchObject({
      word: 'Offline',
      tone: 'unreachable',
    });
    expect(
      describeFeed({ ...base, connection: 'open', settled: false, source: 'unreachable' }).word,
    ).toBe('Connecting');
    expect(describeFeed({ ...base, connection: 'open', dropped: ['a/r1'] }).title).toContain(
      'hiding 1 run',
    );
  });
});

describe('touchesDocument', () => {
  const change = {
    type: 'run.changed' as const,
    folder: 'a',
    runId: 'r1',
    paths: ['3-write/prd.md', '4-site/index.html'],
  };
  it('matches the file, or anything under a folder document, of the same run', () => {
    expect(touchesDocument(change, { pipelineId: 'a', runId: 'r1' }, '3-write/prd.md')).toBe(true);
    expect(touchesDocument(change, { pipelineId: 'a', runId: 'r1' }, '4-site/')).toBe(true);
    expect(touchesDocument(change, { pipelineId: 'a', runId: 'r1' }, '5-other/x.md')).toBe(false);
    expect(touchesDocument(change, { pipelineId: 'b', runId: 'r1' }, '3-write/prd.md')).toBe(false);
  });
});

describe('live protocol frames', () => {
  it('parses every live server frame and the subscribe frames', () => {
    const frames: unknown[] = [
      { type: 'runs.snapshot', generatedAt: 'x', pipelines: {}, runs: [{ anything: 1 }] },
      { type: 'run.changed', folder: 'a', runId: 'r', paths: [], run: null, reason: 'gone' },
      { type: 'pipelines.changed', pipelines: {} },
      { type: 'sessions.changed', sessions: [{ junk: true }] },
      { type: 'workspaces.snapshot', exists: true, workspaces: [] },
      { type: 'live.tick', at: '2026-10-31T19:00:00Z' },
      {
        type: 'system.memory',
        totalBytes: 1,
        usedBytes: 1,
        availableBytes: 0,
        usedPercent: 100,
        loadAverage: [],
        cpuCount: 1,
      },
    ];
    for (const frame of frames) expect(serverMessageSchema.safeParse(frame).success).toBe(true);
    expect(
      clientMessageSchema.safeParse({ type: 'live.subscribe', topics: ['runs', 'system'] }).success,
    ).toBe(true);
    expect(clientMessageSchema.safeParse({ type: 'live.subscribe', topics: ['all'] }).success).toBe(
      false,
    );
    expect(clientMessageSchema.safeParse({ type: 'live.subscribe', topics: [] }).success).toBe(
      false,
    );
  });
});

describe('pushed sessions', () => {
  const session = (name: string, startedAt: string, age: string = '0s'): FactorySession => ({
    session: name,
    factoryId: 'a-factory',
    harness: 'claude',
    startedAt,
    ageSeconds: 0,
    age,
  });

  it('keeps the well-formed rows, oldest first', () => {
    const list: FactorySession[] = parseSessionList([
      { ...session('b', '2026-10-31T10:00:00Z'), ageSeconds: 5 },
      { junk: true },
      { ...session('a', '2026-10-31T09:00:00Z'), ageSeconds: 3605 },
    ]);
    expect(list.map((s: FactorySession): string => s.session)).toEqual(['a', 'b']);
  });

  it('counts the age from startedAt, keeps the API text when it cannot', () => {
    const now: number = Date.parse('2026-10-31T10:02:05Z');
    expect(withLiveAge(now)(session('a', '2026-10-31T10:00:00Z'))).toMatchObject({
      ageSeconds: 125,
      age: '2m',
    });
    expect(withLiveAge(now)(session('a', 'not a date', '7m')).age).toBe('7m');
  });

  it('merges the local rows: provisional until listed, stopped until gone', () => {
    const live: FactorySession[] = [session('x', '2026-10-31T10:00:00Z')];
    const merged: FactorySession[] = mergeSessions(
      live,
      [session('x', '2026-10-31T10:00:01Z'), session('y', '2026-10-31T10:00:02Z')],
      ['x'],
    );
    expect(merged.map((s: FactorySession): string => s.session)).toEqual(['y']);
  });
});
