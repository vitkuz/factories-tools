import { describe, expect, it } from 'vitest';
import { runStateSchema } from '../src/features/runs/lib/dashboard.schema';
import type { RunState } from '../src/features/runs/lib/types';
import type { TimelineRow } from '../src/features/runs/runs.types';
import {
  jumpKindOf,
  promptPreview,
  stepTimeLabel,
  timelineRows,
  type PromptPreview,
  type StepTiming,
} from '../src/features/runs/runs.utils';
import { kpPipeline, kpState } from './helpers';
import { rankPipeline } from '../src/shared/graph';

const NOW: number = Date.parse('2026-10-20T12:00:00Z');

const state = (steps: Record<string, unknown>): RunState =>
  runStateSchema.parse({
    runId: 'r',
    pipelineName: 'p',
    status: 'RUNNING',
    createdAt: '2026-10-20T10:00:00Z',
    updatedAt: '2026-10-20T11:00:00Z',
    steps,
  });

const slugs = (rows: TimelineRow[]): string[] => rows.map((r: TimelineRow): string => r.slug);

describe('timelineRows', () => {
  const s: RunState = state({
    frame: {
      status: 'COMPLETED',
      startedAt: '2026-10-20T10:00:00Z',
      completedAt: '2026-10-20T10:05:00Z',
    },
    market: {
      status: 'COMPLETED',
      startedAt: '2026-10-20T10:06:00Z',
      completedAt: '2026-10-20T10:09:00Z',
    },
    rivals: {
      status: 'COMPLETED',
      startedAt: '2026-10-20T10:06:01Z',
      completedAt: '2026-10-20T10:08:00Z',
    },
    review: {
      status: 'COMPLETED',
      passes: 2,
      event: 'APPROVE',
      history: [
        {
          pass: 1,
          event: 'REVISE',
          startAt: '2026-10-20T10:10:00Z',
          endAt: '2026-10-20T10:12:00Z',
        },
        {
          pass: 2,
          event: 'APPROVE',
          startAt: '2026-10-20T10:20:00Z',
          endAt: '2026-10-20T10:21:00Z',
        },
      ],
    },
    late: {
      status: 'COMPLETED',
      passes: 3,
      startedAt: '2026-10-20T10:30:00Z',
      completedAt: '2026-10-20T10:31:00Z',
    },
    never: { status: 'PENDING' },
    dropped: { status: 'SKIPPED', skipReason: 'review returned APPROVE' },
  });
  // The graph order deliberately differs from the run order.
  const order: string[] = ['never', 'review', 'rivals', 'market', 'frame', 'late', 'dropped'];
  const rows: TimelineRow[] = timelineRows(s, NOW)(order);

  it('puts timed steps by first start, then the rest in graph order', () => {
    expect(slugs(rows)).toEqual([
      'frame',
      'market',
      'rivals',
      'review',
      'late',
      'never',
      'dropped',
    ]);
  });

  it('flags a step that started before the one above finished', () => {
    expect(rows.map((r: TimelineRow): boolean => r.parallel)).toEqual([
      false,
      false,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it('keeps every pass of a loop, and the first start', () => {
    const review: TimelineRow = rows[3];
    expect(review.passes).toBe(2);
    expect(review.attempts.map((a) => a.result)).toEqual(['REVISE', 'APPROVE']);
    expect(review.startedAt).toBe('2026-10-20T10:10:00Z');
  });

  it('counts passes the state kept no timings for', () => {
    const late: TimelineRow = rows[4];
    expect(late.passes).toBe(3);
    expect(late.attempts).toHaveLength(1);
  });

  it('marks steps that never ran, with the skip reason', () => {
    const [never, dropped]: TimelineRow[] = rows.slice(5);
    expect(never.ran).toBe(false);
    expect(never.startedAt).toBeNull();
    expect(dropped.ran).toBe(false);
    expect(dropped.skipReason).toBe('review returned APPROVE');
    expect(rows[0].ran).toBe(true);
  });

  it('is the graph order without a state', () => {
    expect(slugs(timelineRows(null, NOW)(order))).toEqual(order);
  });

  it('lists every step of a recorded kp-factory run once', () => {
    const kpOrder: string[] = rankPipeline(kpPipeline()).order;
    const kpRows: TimelineRow[] = timelineRows(kpState(), NOW)(kpOrder);
    expect([...slugs(kpRows)].sort()).toEqual([...kpOrder].sort());
  });
});

describe('stepTimeLabel', () => {
  const base: StepTiming = {
    status: 'COMPLETED',
    human: false,
    workingMs: 120_000,
    attemptCount: 1,
    waitedMs: null,
  };

  it('says the working time', () => {
    expect(stepTimeLabel(1)(base)).toBe('2 min');
  });

  it('sums a loop whose passes were all timed', () => {
    expect(stepTimeLabel(2)({ ...base, workingMs: 300_000, attemptCount: 2 })).toBe('5 min ×2');
  });

  it('says the last pass when earlier ones were not timed', () => {
    expect(stepTimeLabel(3)({ ...base, workingMs: 40_000 })).toBe('last pass 40 s');
  });

  it('says waited for a human gate and nothing for a step that never ran', () => {
    expect(stepTimeLabel(1)({ ...base, human: true, workingMs: null, waitedMs: 60_000 })).toBe(
      'waited 1 min',
    );
    expect(stepTimeLabel(0)({ ...base, status: 'SKIPPED' })).toBe('skipped');
    expect(stepTimeLabel(0)({ ...base, status: 'PENDING', workingMs: null })).toBe('');
    expect(stepTimeLabel(1)({ ...base, status: 'waiting' })).toBe('waiting for you');
  });
});

describe('promptPreview', () => {
  it('collapses a multi-line prompt to its first sentence and keeps the full text', () => {
    const p: PromptPreview = promptPreview('Do the thing. Then more.\n\nSecond {{x}}.\n');
    expect(p.preview).toBe('Do the thing.');
    expect(p.full).toBe('Do the thing. Then more.\n\nSecond {{x}}.');
    expect(p.expandable).toBe(true);
  });
  it('is not expandable when the preview is the whole text, or empty', () => {
    expect(promptPreview('Just one line.').expandable).toBe(false);
    expect(promptPreview('  ')).toEqual({ preview: '', full: '', expandable: false });
  });
});

describe('jumpKindOf', () => {
  const kindOf = jumpKindOf(['frame-problem', 'approve-frame']);

  it('links a step that has a card, and END', () => {
    expect(kindOf('approve-frame')).toBe('step');
    expect(kindOf('END')).toBe('end');
  });

  it('leaves an unknown target as plain text', () => {
    expect(kindOf('nope')).toBe('none');
  });
});
