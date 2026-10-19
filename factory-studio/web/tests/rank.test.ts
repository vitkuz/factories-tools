import { describe, expect, it } from 'vitest';
import { END_ID, START_ID, edgeKey, rankPipeline, type PipelineRanks } from '../src/shared/graph';
import { kpPipeline, kpState, r, tiny } from './helpers';

describe('rankPipeline: waves', () => {
  it('a capped route is the only back edge of a review loop', () => {
    const ranks: PipelineRanks = rankPipeline(
      tiny(['write'], {
        write: { DONE: r(['review']) },
        review: { REVISE: r(['write'], { max: 2, onMax: ['final'] }), PASS: r(['final']) },
        final: { DONE: r([END_ID]) },
      }),
    );
    expect([...ranks.back]).toEqual([edgeKey('review', 'write')]);
    expect(ranks.rank).toEqual({ [START_ID]: 0, write: 1, review: 2, final: 3, [END_ID]: 4 });
    expect(ranks.order).toEqual(['write', 'review', 'final']);
  });

  it('the recorder and the layout agree on every wave of klevrs-kp-factory', () => {
    const ranks: PipelineRanks = rankPipeline(kpPipeline());
    const recorded: Record<string, number> = Object.fromEntries(
      Object.entries(kpState().steps).map(([slug, step]): [string, number] => [slug, step.order]),
    );
    const laidOut: Record<string, number> = Object.fromEntries(
      Object.keys(recorded).map((slug: string): [string, number] => [slug, ranks.rank[slug]]),
    );
    expect(Object.keys(laidOut)).toHaveLength(25);
    expect(laidOut).toEqual(recorded);
    expect(ranks.rank[END_ID]).toBe(15);
  });

  it('the capped routes of klevrs-kp-factory are its only loops', () => {
    const ranks: PipelineRanks = rankPipeline(kpPipeline());
    expect([...ranks.back].sort()).toEqual(
      [
        'check-facts->extract-fields',
        'verify-claims->write-blocks',
        'verify-claims->write-demo-buyer',
        'verify-claims->build-claims',
        'verify-claims->route-mediaplan',
        'qa-demo-landing->build-demo-landing',
        'qa-landing->build-landing',
        'qa-slides->build-slides',
        'approve-kp->write-blocks',
        'approve-kp->write-demo-buyer',
        'approve-kp->build-demo-landing',
        'approve-kp->build-landing',
        'approve-kp->build-slides',
      ].sort(),
    );
  });

  it('a shortcut never pulls its target into an earlier wave', () => {
    const ranks: PipelineRanks = rankPipeline(
      tiny(['research'], {
        research: { DONE: r(['write']), SKIP: r(['final']) },
        write: { DONE: r(['final']) },
        final: { DONE: r([END_ID]) },
      }),
    );
    expect(ranks.rank).toMatchObject({ research: 1, write: 2, final: 3 });
    expect(ranks.back.size).toBe(0);
  });

  it('an uncapped loop (a validator warning) still draws: the closing edge is the back edge', () => {
    const ranks: PipelineRanks = rankPipeline(
      tiny(['a'], {
        a: { DONE: r(['b']) },
        b: { AGAIN: r(['a']), DONE: r([END_ID]) },
      }),
    );
    expect([...ranks.back]).toEqual([edgeKey('b', 'a')]);
    expect(ranks.rank).toMatchObject({ a: 1, b: 2, [END_ID]: 3 });
  });

  it('a pair that is both a plain route and a capped retry goes forward', () => {
    const ranks: PipelineRanks = rankPipeline(
      tiny(['a'], {
        a: { DONE: r(['b']), RETRY: r(['b'], { max: 1 }) },
        b: { DONE: r([END_ID]) },
      }),
    );
    expect(ranks.back.size).toBe(0);
    expect(ranks.rank).toMatchObject({ a: 1, b: 2 });
  });

  it('a step unreachable from START sits in wave 1', () => {
    const ranks: PipelineRanks = rankPipeline(
      tiny(['a'], { a: { DONE: r([END_ID]) }, orphan: { DONE: r([END_ID]) } }),
    );
    expect(ranks.rank).toMatchObject({ a: 1, orphan: 1 });
    expect(ranks.order).toEqual(['a', 'orphan']);
  });
});

describe('rankPipeline: order inside a wave', () => {
  it('lists the waves left to right, the main-row card first, then by barycentre', () => {
    const ranks: PipelineRanks = rankPipeline(kpPipeline());
    const wave = (n: number): string[] =>
      ranks.order.filter((slug: string): boolean => ranks.rank[slug] === n);
    expect(wave(6)).toEqual(['review-inputs', 'evaluate-against-expected']);
    expect(wave(7)).toEqual(['route-mediaplan', 'research-buyer']);
    // route-mediaplan's three calculators (barycentre 0) before research-buyer's two writers (1).
    expect(wave(8)).toEqual([
      'calc-mediaplan-ideas',
      'calc-mediaplan-mini',
      'calc-mediaplan-personal',
      'write-demo-buyer',
      'write-blocks',
    ]);
    expect(wave(11)).toEqual(['build-demo-landing', 'build-landing', 'build-slides']);
    // Each qa step follows its builder's position, so the row edges into wave 12 do not cross.
    expect(wave(12)).toEqual(['qa-demo-landing', 'qa-landing', 'qa-slides']);
    expect(wave(14)).toEqual(['prepare-crm-update', 'evaluate-kp-against-expected']);
    const waves: number[] = ranks.order.map((slug: string): number => ranks.rank[slug]);
    expect(waves).toEqual([...waves].sort((a: number, b: number): number => a - b));
  });

  it('the main row prefers an event that leads to a step over one that ends the run', () => {
    const ranks: PipelineRanks = rankPipeline(
      tiny(['gate'], {
        gate: { STOP: r([END_ID]), APPROVE: r(['side', 'work']) },
        side: { DONE: r([END_ID]) },
        work: { DONE: r([END_ID]) },
      }),
    );
    // Declaration order would put `side` first; both have the same barycentre, `side` is the
    // happy event's first step target, so it holds the row.
    expect(ranks.order).toEqual(['gate', 'side', 'work']);
  });
});
