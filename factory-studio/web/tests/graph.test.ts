import { describe, expect, it } from 'vitest';
import {
  buildGraph,
  focusStepOf,
  type GraphResult,
  type StepNodeData,
} from '../src/features/runs/lib/graph';
import type { RunState } from '../src/features/runs/lib/types';
import { footerFor } from '../src/features/runs/components/nodes/StepNode';
import { isOffRow, type EdgeData, type GraphEdge } from '../src/shared/graph';
import { kpPipeline, kpState } from './helpers';

const dataOf = (graph: GraphResult, id: string): EdgeData => {
  const edge: GraphEdge | undefined = graph.edges.find((e: GraphEdge): boolean => e.id === id);
  if (!edge) throw new Error(`no edge ${id}`);
  return edge.data as EdgeData;
};
const offRow = (graph: GraphResult): GraphEdge[] =>
  graph.edges.filter((e: GraphEdge): boolean => isOffRow(e.data as EdgeData));
const quiet = (graph: GraphResult): string[] =>
  graph.edges.filter((e: GraphEdge): boolean => (e.data as EdgeData).quiet).map((e) => e.id);

describe('buildGraph with a run', () => {
  const graph: GraphResult = buildGraph(kpPipeline())(kpState());

  it('keeps the loops, escapes and jumps the run took, and hushes the rest', () => {
    expect(offRow(graph)).toHaveLength(29);
    const taken: string[] = offRow(graph)
      .filter((e: GraphEdge): boolean => (e.data as EdgeData).taken)
      .map((e: GraphEdge): string => e.id)
      .sort();
    expect(taken).toEqual(
      [
        'e:check-facts->extract-fields',
        'e:verify-claims->write-blocks',
        'e:verify-claims->write-demo-buyer',
        'e:verify-claims->route-mediaplan',
        'e:qa-slides->build-slides',
        'e:evaluate-against-expected->END',
      ].sort(),
    );
    expect(quiet(graph)).toHaveLength(23);
    expect(quiet(graph)).not.toContain('e:check-facts->extract-fields');
    expect(quiet(graph)).toContain('e:approve-kp->END:max');
    expect(quiet(graph)).toContain('e:qa-landing->END');
  });

  it('never hushes a row edge, taken or not', () => {
    for (const e of graph.edges) {
      const data: EdgeData = e.data as EdgeData;
      if (!isOffRow(data)) expect(data.quiet, e.id).toBe(false);
    }
    expect(dataOf(graph, 'e:route-mediaplan->calc-mediaplan-mini')).toMatchObject({
      taken: false,
      quiet: false,
      bypassed: true,
    });
  });

  it('counts a taken loop from one', () => {
    expect(dataOf(graph, 'e:verify-claims->route-mediaplan')).toMatchObject({
      loop: true,
      traversals: 1,
      takenResults: ['REVISE_ALL'],
    });
  });
});

describe('buildGraph without a run (no state.json yet)', () => {
  const graph: GraphResult = buildGraph(kpPipeline())(null);

  it('lights the happy path and hushes every loop, escape and jump', () => {
    expect(dataOf(graph, 'e:START->get-transcript').taken).toBe(true);
    expect(dataOf(graph, 'e:check-facts->find-missing')).toMatchObject({
      taken: true,
      takenResults: ['PASS'],
      quiet: false,
    });
    expect(dataOf(graph, 'e:check-facts->extract-fields')).toMatchObject({
      loop: true,
      taken: false,
      quiet: true,
    });
    expect(quiet(graph)).toHaveLength(28);
  });
});

describe('buildGraph while Claude asks in the studio', () => {
  // The human gate `review-inputs` and the agent step `get-transcript` both running.
  const running = (): RunState => {
    const state: RunState = kpState();
    const steps: RunState['steps'] = Object.fromEntries(
      Object.entries(state.steps).map(([slug, st]) => [
        slug,
        slug === 'review-inputs' || slug === 'get-transcript' ? { ...st, status: 'RUNNING' } : st,
      ]),
    ) as RunState['steps'];
    return { ...state, status: 'RUNNING', steps };
  };
  const dataOf = (graph: GraphResult, slug: string): StepNodeData =>
    graph.nodes.find((n) => n.id === slug)?.data as StepNodeData;

  it('marks only the running human step, and only while a question waits', () => {
    const asking: GraphResult = buildGraph(kpPipeline(), { detailed: false, asking: true })(
      running(),
    );
    expect(dataOf(asking, 'review-inputs').needsYou).toBe(true);
    expect(dataOf(asking, 'get-transcript').needsYou).toBe(false);
    expect(dataOf(asking, 'approve-kp').needsYou).toBe(false);
    expect(footerFor(dataOf(asking, 'review-inputs'))).toEqual({
      left: 'needs you',
      leftTone: 'needs-you',
      right: '',
    });

    const quiet: GraphResult = buildGraph(kpPipeline(), { detailed: false })(running());
    expect(dataOf(quiet, 'review-inputs').needsYou).toBe(false);
    expect(footerFor(dataOf(quiet, 'review-inputs')).left).toBe('running');
  });
});

describe('painting order and the focal step', () => {
  it('paints quiet edges first, taken ones over them, the live one last', () => {
    const graph: GraphResult = buildGraph(kpPipeline())(kpState());
    const order: number[] = graph.edges.map((e: GraphEdge): number => {
      const d: EdgeData = e.data as EdgeData;
      return d.live ? 3 : d.taken ? 2 : d.quiet ? 0 : 1;
    });
    expect(order).toEqual([...order].sort((a: number, b: number): number => a - b));
    expect(graph.focusId).toBeNull();
  });

  it('lifts the live edge over every other edge', () => {
    const state: RunState = {
      ...kpState(),
      status: 'RUNNING',
      frontier: ['build-landing'],
    } as RunState;
    const graph: GraphResult = buildGraph(kpPipeline())(state);
    const lifted: GraphEdge[] = graph.edges.filter((e: GraphEdge): boolean => e.zIndex === 1);
    expect(lifted).toHaveLength(1);
    expect((lifted[0].data as EdgeData).live).toBe(true);
    expect(lifted[0].target).toBe('build-landing');
  });

  it('opens on the step a paused run waits for, else on what is running', () => {
    const paused: RunState = {
      ...kpState(),
      status: 'PAUSED',
      pause: { status: 'AWAITING_INPUT', step: 'approve-kp' },
    } as RunState;
    expect(focusStepOf(paused)).toBe('approve-kp');
    const running: RunState = {
      ...kpState(),
      status: 'RUNNING',
      frontier: ['build-landing'],
    } as RunState;
    expect(focusStepOf(running)).toBe('build-landing');
    expect(focusStepOf(null)).toBeNull();
  });
});
