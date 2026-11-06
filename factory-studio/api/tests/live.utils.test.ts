import { describe, expect, it } from 'vitest';
import {
  capPaths,
  classifyRunPath,
  isActiveRunStatus,
  isLiveFrame,
  isPipelineFile,
  sessionsFingerprint,
  touchesRecord,
} from '../src/features/live/live.utils.js';
import type { FactorySession } from '../src/features/sessions/sessions.types.js';
import { debounceByKey, type DebounceTimers } from '../src/shared/utils/debounce.utils.js';

describe('classifyRunPath', () => {
  it('names the run and the path inside it', () => {
    expect(classifyRunPath('kp-factory/run-1/state.json')).toEqual({
      kind: 'run',
      folder: 'kp-factory',
      runId: 'run-1',
      rest: 'state.json',
    });
    expect(classifyRunPath('kp-factory/run-1/3-write/prd.md')).toEqual({
      kind: 'run',
      folder: 'kp-factory',
      runId: 'run-1',
      rest: '3-write/prd.md',
    });
    expect(classifyRunPath('kp-factory/run-1')).toEqual({
      kind: 'run',
      folder: 'kp-factory',
      runId: 'run-1',
      rest: '',
    });
  });

  it('ignores .trash, dotfiles and the recorder temp files', () => {
    expect(classifyRunPath('.trash/kp-factory/run-1-x/state.json').kind).toBe('ignore');
    expect(classifyRunPath('kp-factory/run-1/state.json.tmp-1234').kind).toBe('ignore');
    expect(classifyRunPath('kp-factory/run-1/.DS_Store').kind).toBe('ignore');
    expect(
      classifyRunPath('kp-factory/run-1/input.md.0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b.tmp').kind,
    ).toBe('ignore');
  });

  it('knows workspaces.json, a pipeline folder, and nothing at all', () => {
    expect(classifyRunPath('workspaces.json')).toEqual({ kind: 'workspaces' });
    expect(classifyRunPath('kp-factory')).toEqual({ kind: 'folder', folder: 'kp-factory' });
    expect(classifyRunPath('')).toEqual({ kind: 'rescan' });
  });
});

describe('record files and pipeline files', () => {
  it('a record changes with state.json, cost.json, pipeline.json or the folder itself', () => {
    expect(touchesRecord(['state.json'])).toBe(true);
    expect(touchesRecord(['3-write/prd.md', 'cost.json'])).toBe(true);
    expect(touchesRecord([''])).toBe(true);
    expect(touchesRecord(['3-write/prd.md', '3-write/state.json'])).toBe(false);
  });

  it('spots pipeline.json at any depth', () => {
    expect(isPipelineFile('kp-factory/pipeline.json')).toBe(true);
    expect(isPipelineFile('pipeline.json')).toBe(true);
    expect(isPipelineFile('kp-factory/knowledge/notes.md')).toBe(false);
    expect(isPipelineFile('kp-factory/pipeline.json.bak')).toBe(false);
  });
});

describe('sessionsFingerprint', () => {
  const session = (
    name: string,
    status: FactorySession['status'],
    age: number,
  ): FactorySession => ({
    session: name,
    factoryId: 'a-factory',
    harness: 'claude',
    startedAt: '2026-01-01T00:00:00.000Z',
    ageSeconds: age,
    age: `${age}s`,
    status,
  });

  it('ignores the ages and the order, sees a status or a membership change', () => {
    const a: string = sessionsFingerprint([session('x', 'idle', 1), session('y', 'working', 5)]);
    expect(sessionsFingerprint([session('y', 'working', 9), session('x', 'idle', 3)])).toBe(a);
    expect(sessionsFingerprint([session('x', 'blocked', 1), session('y', 'working', 5)])).not.toBe(
      a,
    );
    expect(sessionsFingerprint([session('x', 'idle', 1)])).not.toBe(a);
  });
});

describe('isActiveRunStatus', () => {
  it('keeps the runs the recorder may still write to', () => {
    expect(['IDLE', 'RUNNING', 'PAUSED'].map(isActiveRunStatus)).toEqual([true, true, true]);
    expect(['COMPLETED', 'FAILED', 'ABORTED', null, undefined].map(isActiveRunStatus)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('isLiveFrame and capPaths', () => {
  it('recognises live.* frames only', () => {
    expect(isLiveFrame('{"type":"live.subscribe","topics":["runs"]}')).toBe(true);
    expect(isLiveFrame('{"type":"session.answer"}')).toBe(false);
    expect(isLiveFrame('not json')).toBe(false);
  });

  it('dedupes, puts the record files first and caps the list', () => {
    expect(capPaths(['3-write/prd.md', 'state.json', 'state.json', 'a/b/c/d.md'], 2)).toEqual([
      'state.json',
      '3-write/prd.md',
    ]);
  });
});

describe('debounceByKey', () => {
  /** Timers driven by hand: `fire()` runs every callback scheduled so far. */
  const fakeTimers = (): DebounceTimers & {
    fire: () => void;
    scheduled: () => number;
    waits: number[];
    advance: (ms: number) => void;
  } => {
    let callbacks: Map<number, () => void> = new Map();
    let n = 0;
    let clock = 0;
    const waits: number[] = [];
    return {
      waits,
      now: (): number => clock,
      advance: (ms: number): void => {
        clock += ms;
      },
      set: (callback: () => void, ms: number): unknown => {
        n += 1;
        waits.push(ms);
        callbacks = new Map([...callbacks, [n, callback]]);
        return n;
      },
      clear: (handle: unknown): void => {
        const next: Map<number, () => void> = new Map(callbacks);
        next.delete(handle as number);
        callbacks = next;
      },
      fire: (): void => {
        const now: (() => void)[] = [...callbacks.values()];
        callbacks = new Map();
        for (const cb of now) cb();
      },
      scheduled: (): number => callbacks.size,
    };
  };

  it('folds the pushes of one key into one flush, after the last push', () => {
    const timers = fakeTimers();
    const flushed: [string, readonly string[]][] = [];
    const d = debounceByKey<string>(250, (key, items) => void flushed.push([key, items]), timers);
    d.push('a/1', 'state.json.tmp-1');
    d.push('a/1', 'state.json');
    d.push('b/2', '');
    // Every push re-arms its key: only the latest timer per key is live.
    expect(timers.scheduled()).toBe(2);
    expect(d.pending().sort()).toEqual(['a/1', 'b/2']);
    timers.fire();
    expect(flushed).toEqual([
      ['a/1', ['state.json.tmp-1', 'state.json']],
      ['b/2', ['']],
    ]);
    expect(d.pending()).toEqual([]);
  });

  it('never waits longer than maxWaitMs after the first push of a burst', () => {
    const timers = fakeTimers();
    const flushed: string[] = [];
    const d = debounceByKey<string>(250, (key) => void flushed.push(key), timers, 1000);
    d.push('busy', 'a');
    expect(timers.waits.at(-1)).toBe(250);
    timers.advance(200);
    d.push('busy', 'b');
    expect(timers.waits.at(-1)).toBe(250);
    timers.advance(600);
    // 800 ms into the burst: only 200 ms of the max wait are left.
    d.push('busy', 'c');
    expect(timers.waits.at(-1)).toBe(200);
    timers.advance(200);
    d.push('busy', 'd');
    expect(timers.waits.at(-1)).toBe(0);
    timers.fire();
    expect(flushed).toEqual(['busy']);
  });

  it('flushAll flushes now, cancel drops without flushing', () => {
    const timers = fakeTimers();
    const flushed: string[] = [];
    const d = debounceByKey<string>(250, (key) => void flushed.push(key), timers);
    d.push('x', '');
    d.flushAll();
    expect(flushed).toEqual(['x']);
    d.push('y', '');
    d.cancel();
    timers.fire();
    expect(flushed).toEqual(['x']);
  });
});
