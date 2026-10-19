import { describe, expect, it } from 'vitest';
import { buildGraph, type GraphNode, type GraphResult } from '../src/features/runs/lib/graph';
import {
  END_ID,
  NODE_H,
  START_ID,
  STACK_GAP,
  rankPipeline,
  type EdgeData,
  type GraphEdge,
  type PipelineRanks,
} from '../src/shared/graph';
import { kpPipeline, kpState } from './helpers';

const graph: GraphResult = buildGraph(kpPipeline())(kpState());
const ranks: PipelineRanks = rankPipeline(kpPipeline());
const nodeOf = (id: string): GraphNode => {
  const node: GraphNode | undefined = graph.nodes.find((n: GraphNode): boolean => n.id === id);
  if (!node) throw new Error(`no node ${id}`);
  return node;
};
const steps: GraphNode[] = graph.nodes.filter((n: GraphNode): boolean => n.type === 'step');

describe('layout: one column per wave', () => {
  it('every card of a wave shares one x, and the waves run left to right', () => {
    const xByWave: Map<number, Set<number>> = new Map();
    for (const n of steps) {
      const wave: number = ranks.rank[n.id];
      xByWave.set(wave, new Set([...(xByWave.get(wave) ?? []), n.position.x]));
    }
    expect(xByWave.size).toBe(14);
    for (const xs of xByWave.values()) expect(xs.size).toBe(1);
    const waves: number[] = [...xByWave.keys()].sort((a: number, b: number): number => a - b);
    const xs: number[] = waves.map((w: number): number => [...(xByWave.get(w) ?? [])][0]);
    expect(xs).toEqual([...xs].sort((a: number, b: number): number => a - b));
    expect(nodeOf(START_ID).position.x).toBeLessThan(xs[0]);
    expect(nodeOf(END_ID).position.x).toBeGreaterThan(xs[xs.length - 1]);
  });

  it('the main-row card sits on the row line and its siblings stack below without overlap', () => {
    const byX: Map<number, GraphNode[]> = new Map();
    for (const n of steps) byX.set(n.position.x, [...(byX.get(n.position.x) ?? []), n]);
    for (const column of byX.values()) {
      const sorted: GraphNode[] = [...column].sort(
        (a: GraphNode, b: GraphNode): number => a.position.y - b.position.y,
      );
      expect(sorted[0].position.y).toBe(-NODE_H / 2);
      sorted.forEach((n: GraphNode, i: number): void => {
        expect((n.data as { stackIndex: number }).stackIndex).toBe(i);
        const next: GraphNode | undefined = sorted[i + 1];
        if (next) expect(next.position.y).toBe(n.position.y + (n.height ?? NODE_H) + STACK_GAP);
      });
    }
    expect(byX.get(nodeOf('write-blocks').position.x)).toHaveLength(5);
  });

  it('no forward edge points left; every loop points left', () => {
    for (const e of graph.edges) {
      const data: EdgeData = e.data as EdgeData;
      const dx: number = nodeOf(e.target).position.x - nodeOf(e.source).position.x;
      if (data.loop) expect(dx, e.id).toBeLessThan(0);
      else expect(dx, e.id).toBeGreaterThan(0);
    }
  });

  it('a lane clears every column it spans', () => {
    const bounds = (lo: number, hi: number): { top: number; bottom: number } =>
      graph.nodes
        .filter((n: GraphNode): boolean => ranks.rank[n.id] >= lo && ranks.rank[n.id] <= hi)
        .reduce(
          (acc: { top: number; bottom: number }, n: GraphNode) => ({
            top: Math.min(acc.top, n.position.y),
            bottom: Math.max(acc.bottom, n.position.y + (n.height ?? NODE_H)),
          }),
          { top: Infinity, bottom: -Infinity },
        );
    const laned: GraphEdge[] = graph.edges.filter(
      (e: GraphEdge): boolean => (e.data as EdgeData).lane !== 'row',
    );
    expect(laned.length).toBeGreaterThan(0);
    for (const e of laned) {
      const data: EdgeData = e.data as EdgeData;
      const a: number = ranks.rank[e.source];
      const b: number = ranks.rank[e.target];
      const { top, bottom } = bounds(Math.min(a, b), Math.max(a, b));
      if (data.lane === 'above') expect(data.laneY, e.id).toBeLessThan(top);
      else expect(data.laneY, e.id).toBeGreaterThan(bottom);
    }
  });
});
