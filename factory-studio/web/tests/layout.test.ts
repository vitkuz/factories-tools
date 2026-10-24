import { describe, expect, it } from 'vitest';
import { buildGraph, type GraphResult } from '../src/features/runs/lib/graph';
import {
  buildDefinitionGraph,
  END_ID,
  labelRowWidth,
  NODE_H,
  NODE_W,
  rankPipeline,
  simplifyPoints,
  START_ID,
  type Box,
  type EdgeData,
  type GraphEdge,
  type GraphNodeOf,
  type GraphPipeline,
  type PipelineRanks,
  type Point,
  type StepCardData,
} from '../src/shared/graph';
import { kpPipeline, kpState, r, tiny } from './helpers';

/* ------------------------------------------------------------------ fixtures */

type AnyNode = GraphNodeOf<StepCardData>;

interface Drawing {
  nodes: AnyNode[];
  edges: GraphEdge[];
  bounds: Box;
}

const cardData = (slug: string, stackIndex: number): StepCardData => ({
  slug,
  agent: 'general-purpose',
  model: 'default',
  human: false,
  inputs: [],
  outputs: [],
  knowledge: [],
  detailed: false,
  stackIndex,
});

const definition = (pipeline: GraphPipeline): Drawing =>
  buildDefinitionGraph(pipeline, cardData, (): number => NODE_H);

/** The shape of mckinsey-research-factory: a gate, a four-way fan-out and fan-in, a review loop. */
const mckinsey: GraphPipeline = tiny(['frame'], {
  frame: { DONE: r(['approve']) },
  approve: {
    APPROVE: r(['market', 'competitors', 'economics', 'operations']),
    REVISE: r(['frame'], { max: 2, onMax: ['market', 'competitors', 'economics', 'operations'] }),
  },
  market: { DONE: r(['synthesize']) },
  competitors: { DONE: r(['synthesize']) },
  economics: { DONE: r(['synthesize']) },
  operations: { DONE: r(['synthesize']) },
  synthesize: { DONE: r(['pressure']) },
  pressure: { APPROVE: r(['report']), REVISE: r(['synthesize'], { max: 2, onMax: ['report'] }) },
  report: { DONE: r([END_ID]) },
});

/** Loops between rows, a jump over three columns, two exits to END from one step, a self loop. */
const knotty: GraphPipeline = tiny(['a'], {
  a: { DONE: r(['b', 'c']), SKIP: r(['e']) },
  b: { DONE: r(['d']) },
  c: { DONE: r(['d']), RETRY: r(['c'], { max: 3, onMax: ['d'] }) },
  d: {
    PASS: r(['e']),
    REVISE_B: r(['b'], { max: 2, onMax: ['e'] }),
    REVISE_C: r(['c'], { max: 2, onMax: ['e'] }),
  },
  e: { DONE: r(['f']), REJECT: r([END_ID]), AGAIN: r(['a'], { max: 1, onMax: [END_ID] }) },
  f: { DONE: r([END_ID]) },
});

const drawings: Array<[string, Drawing]> = [
  ['klevrs-kp-factory with its run', buildGraph(kpPipeline())(kpState())],
  ['klevrs-kp-factory without state', buildGraph(kpPipeline())(null)],
  ['mckinsey shape', definition(mckinsey)],
  ['knotty shape', definition(knotty)],
];

/* ------------------------------------------------------------------ geometry helpers */

const boxOf = (n: AnyNode): Box => ({
  x: n.position.x,
  y: n.position.y,
  width: n.width ?? NODE_W,
  height: n.height ?? NODE_H,
});

const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The polyline's axis-aligned segments, as thin boxes (a 1 px inset keeps a touch from counting). */
const segmentBoxes = (points: readonly Point[]): Box[] =>
  simplifyPoints(points).flatMap((p: Point, i: number, pts: Point[]): Box[] => {
    const q: Point | undefined = pts[i + 1];
    if (!q) return [];
    return [
      {
        x: Math.min(p.x, q.x) + 1,
        y: Math.min(p.y, q.y) + 1,
        width: Math.max(0, Math.abs(q.x - p.x) - 2),
        height: Math.max(0, Math.abs(q.y - p.y) - 2),
      },
    ];
  });

const dataOf = (e: GraphEdge): EdgeData => e.data as EdgeData;
const pointsOf = (e: GraphEdge): Point[] => dataOf(e).points ?? [];
const nodeOf = (d: Drawing, id: string): AnyNode => {
  const node: AnyNode | undefined = d.nodes.find((n: AnyNode): boolean => n.id === id);
  if (!node) throw new Error(`no node ${id}`);
  return node;
};
const isOrthogonal = (points: readonly Point[]): boolean =>
  simplifyPoints(points).every(
    (p: Point, i: number, pts: Point[]): boolean =>
      i === 0 || p.x === pts[i - 1].x || p.y === pts[i - 1].y,
  );

/* ------------------------------------------------------------------ the invariants */

describe.each(drawings)('layout invariants: %s', (_name: string, d: Drawing) => {
  const steps: AnyNode[] = d.nodes.filter((n: AnyNode): boolean => n.type === 'step');

  it('no two cards overlap', () => {
    d.nodes.forEach((a: AnyNode, i: number): void => {
      d.nodes.slice(i + 1).forEach((b: AnyNode): void => {
        expect(overlaps(boxOf(a), boxOf(b)), `${a.id} / ${b.id}`).toBe(false);
      });
    });
  });

  it('every edge is an orthogonal polyline from its source card to its target card', () => {
    for (const e of d.edges) {
      const pts: Point[] = pointsOf(e);
      expect(pts.length, e.id).toBeGreaterThanOrEqual(2);
      expect(isOrthogonal(pts), e.id).toBe(true);
      const src: Box = boxOf(nodeOf(d, e.source));
      const tgt: Box = boxOf(nodeOf(d, e.target));
      const first: Point = pts[0];
      const last: Point = pts[pts.length - 1];
      const onBorder = (p: Point, b: Box): boolean =>
        p.x >= b.x - 0.01 &&
        p.x <= b.x + b.width + 0.01 &&
        p.y >= b.y - 0.01 &&
        p.y <= b.y + b.height + 0.01;
      expect(onBorder(first, src), `${e.id} starts on its source`).toBe(true);
      expect(onBorder(last, tgt), `${e.id} ends on its target`).toBe(true);
    }
  });

  it('no edge segment passes through a card', () => {
    for (const e of d.edges) {
      for (const seg of segmentBoxes(pointsOf(e))) {
        for (const n of d.nodes) {
          expect(overlaps(seg, boxOf(n)), `${e.id} crosses ${n.id}`).toBe(false);
        }
      }
    }
  });

  it('a loop stays between its two columns and beside its two rows', () => {
    const loops: GraphEdge[] = d.edges.filter((e: GraphEdge): boolean => dataOf(e).loop);
    expect(loops.length).toBeGreaterThan(0);
    for (const e of loops) {
      const src: Box = boxOf(nodeOf(d, e.source));
      const tgt: Box = boxOf(nodeOf(d, e.target));
      const top: number = Math.min(src.y, tgt.y);
      const bottom: number = Math.max(src.y + src.height, tgt.y + tgt.height);
      for (const p of pointsOf(e)) {
        expect(p.x, `${e.id} x`).toBeGreaterThanOrEqual(tgt.x);
        expect(p.x, `${e.id} x`).toBeLessThanOrEqual(src.x + src.width);
        expect(p.y, `${e.id} y`).toBeGreaterThanOrEqual(top);
        // Below the lower of the two rows by at most the gap that row's lanes take.
        expect(p.y, `${e.id} y`).toBeLessThan(bottom + 160);
      }
    }
  });

  it('every END-bound jump rides one exit rail above the first row', () => {
    const rowTop: number = Math.min(...steps.map((n: AnyNode): number => n.position.y));
    const rails: Set<number> = new Set(
      d.edges
        .filter(
          (e: GraphEdge): boolean => e.target === END_ID && pointsOf(e).some((p) => p.y < rowTop),
        )
        .flatMap((e: GraphEdge): number[] =>
          pointsOf(e)
            .filter((p: Point): boolean => p.y < rowTop)
            .map((p: Point): number => Math.round(p.y)),
        ),
    );
    expect(rails.size).toBeLessThanOrEqual(1);
  });

  it('pills of edges off the row sit on one of their own horizontal runs and never on each other', () => {
    const labelled: GraphEdge[] = d.edges.filter(
      (e: GraphEdge): boolean => dataOf(e).lane !== 'row' && dataOf(e).label !== undefined,
    );
    for (const e of labelled) {
      const label: Point = dataOf(e).label as Point;
      const pts: Point[] = simplifyPoints(pointsOf(e));
      const onRun: boolean = pts.some(
        (p: Point, i: number): boolean =>
          i > 0 &&
          p.y === pts[i - 1].y &&
          Math.abs(p.y - label.y) < 0.01 &&
          label.x >= Math.min(p.x, pts[i - 1].x) - 60 &&
          label.x <= Math.max(p.x, pts[i - 1].x) + 60,
      );
      expect(onRun, `${e.id} label at ${label.x},${label.y}`).toBe(true);
    }
    const width = (e: GraphEdge): number => dataOf(e).labelMaxWidth ?? labelRowWidth(dataOf(e));
    labelled.forEach((a: GraphEdge, i: number): void => {
      labelled.slice(i + 1).forEach((b: GraphEdge): void => {
        const la: Point = dataOf(a).label as Point;
        const lb: Point = dataOf(b).label as Point;
        if (Math.abs(la.y - lb.y) >= 20) return;
        expect(Math.abs(la.x - lb.x), `${a.id} vs ${b.id}`).toBeGreaterThanOrEqual(
          (width(a) + width(b)) / 2 - 1,
        );
      });
    });
  });

  it('the bounds hold every card and every edge point', () => {
    const inside = (p: Point): boolean =>
      p.x >= d.bounds.x - 0.01 &&
      p.x <= d.bounds.x + d.bounds.width + 0.01 &&
      p.y >= d.bounds.y - 0.01 &&
      p.y <= d.bounds.y + d.bounds.height + 0.01;
    for (const n of d.nodes) {
      const b: Box = boxOf(n);
      expect(inside({ x: b.x, y: b.y }), n.id).toBe(true);
      expect(inside({ x: b.x + b.width, y: b.y + b.height }), n.id).toBe(true);
    }
    for (const e of d.edges) for (const p of pointsOf(e)) expect(inside(p), e.id).toBe(true);
  });
});

/* ------------------------------------------------------------------ columns and rows */

describe('layout: one column per wave, rows aligned across columns', () => {
  const graph: GraphResult = buildGraph(kpPipeline())(kpState());
  const ranks: PipelineRanks = rankPipeline(kpPipeline());
  const steps: AnyNode[] = graph.nodes.filter((n: AnyNode): boolean => n.type === 'step');

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
    expect(nodeOf(graph, START_ID).position.x).toBeLessThan(xs[0]);
    expect(nodeOf(graph, END_ID).position.x).toBeGreaterThan(xs[xs.length - 1]);
  });

  it('the main row is centred on y = 0 and every stack index is one row, the same y in every column', () => {
    const yByRow: Map<number, Set<number>> = new Map();
    for (const n of steps) {
      const row: number = (n.data as StepCardData).stackIndex;
      yByRow.set(row, new Set([...(yByRow.get(row) ?? []), n.position.y]));
    }
    expect(yByRow.get(0)).toEqual(new Set([-NODE_H / 2]));
    expect(yByRow.size).toBe(5);
    for (const ys of yByRow.values()) expect(ys.size).toBe(1);
    const rows: number[] = [...yByRow.keys()].sort((a: number, b: number): number => a - b);
    const ys: number[] = rows.map((row: number): number => [...(yByRow.get(row) ?? [])][0]);
    expect(ys).toEqual([...ys].sort((a: number, b: number): number => a - b));
  });

  it('forward edges point right, loops point left', () => {
    for (const e of graph.edges) {
      const dx: number = nodeOf(graph, e.target).position.x - nodeOf(graph, e.source).position.x;
      if (dataOf(e).loop) expect(dx, e.id).toBeLessThan(0);
      else expect(dx, e.id).toBeGreaterThan(0);
    }
  });

  it('is deterministic and does not move when the run state arrives', () => {
    const again: GraphResult = buildGraph(kpPipeline())(kpState());
    expect(again.nodes.map((n: AnyNode): Point => n.position)).toEqual(
      graph.nodes.map((n: AnyNode): Point => n.position),
    );
    const stateless: GraphResult = buildGraph(kpPipeline())(null);
    const positions = (g: GraphResult): Record<string, Point> =>
      Object.fromEntries(g.nodes.map((n: AnyNode): [string, Point] => [n.id, n.position]));
    expect(positions(stateless)).toEqual(positions(graph));
    const routes = (g: GraphResult): Record<string, Point[]> =>
      Object.fromEntries(g.edges.map((e: GraphEdge): [string, Point[]] => [e.id, pointsOf(e)]));
    expect(routes(stateless)).toEqual(routes(graph));
  });
});

/* ------------------------------------------------------------------ specific routes */

describe('layout: where the edges go', () => {
  const d: Drawing = definition(knotty);
  const edge = (id: string): GraphEdge => {
    const found: GraphEdge | undefined = d.edges.find((e: GraphEdge): boolean => e.id === id);
    if (!found) throw new Error(`no edge ${id}`);
    return found;
  };

  it('a same-row loop is one U under the two cards', () => {
    const pts: Point[] = simplifyPoints(pointsOf(edge('e:d->b')));
    const dCard: Box = boxOf(nodeOf(d, 'd'));
    const bCard: Box = boxOf(nodeOf(d, 'b'));
    expect(pts).toHaveLength(4);
    expect(pts[0].y).toBe(dCard.y + dCard.height);
    expect(pts[1].y).toBe(pts[2].y);
    expect(pts[1].y).toBeGreaterThan(dCard.y + dCard.height);
    expect(pts[3]).toEqual({ x: bCard.x + bCard.width * 0.2, y: bCard.y + bCard.height });
  });

  it('a loop into a lower row drops through the channel right of its target', () => {
    const pts: Point[] = simplifyPoints(pointsOf(edge('e:d->c')));
    const cCard: Box = boxOf(nodeOf(d, 'c'));
    expect(pts).toHaveLength(6);
    expect(pts[2].x).toBeGreaterThan(cCard.x + cCard.width);
    expect(pts[5]).toEqual({ x: cCard.x + cCard.width * 0.2, y: cCard.y + cCard.height });
  });

  it('a self loop leaves and re-enters the bottom of its own card', () => {
    const pts: Point[] = simplifyPoints(pointsOf(edge('e:c->c')));
    const c: Box = boxOf(nodeOf(d, 'c'));
    expect(pts).toHaveLength(4);
    expect(pts[0].x).toBeGreaterThan(pts[3].x);
    expect(pts.every((p: Point): boolean => p.x >= c.x && p.x <= c.x + c.width)).toBe(true);
  });

  it('a jump over a column travels above the first row', () => {
    const pts: Point[] = pointsOf(edge('e:a->e'));
    const rowTop: number = Math.min(...d.nodes.map((n: AnyNode): number => n.position.y));
    expect(pts.some((p: Point): boolean => p.y < rowTop)).toBe(true);
    const e: Box = boxOf(nodeOf(d, 'e'));
    expect(pts[pts.length - 1]).toEqual({ x: e.x + e.width * 0.8, y: e.y });
  });

  it('an exit to END comes down the last channel and enters END from the left', () => {
    const end: Box = boxOf(nodeOf(d, END_ID));
    for (const id of ['e:e->END:max']) {
      const pts: Point[] = simplifyPoints(pointsOf(edge(id)));
      const last: Point = pts[pts.length - 1];
      expect(last.x, id).toBe(end.x);
      expect(last.y, id).toBe(end.y + end.height / 2);
      expect(pts[pts.length - 2].y, id).toBe(last.y);
    }
  });

  it('two exits from one step to END share the rail and keep their pills apart', () => {
    const reject: EdgeData = dataOf(edge('e:e->END'));
    const max: EdgeData = dataOf(edge('e:e->END:max'));
    expect(reject.jump).toBe(true);
    expect((reject.label as Point).y).toBe((max.label as Point).y);
    expect(Math.abs((reject.label as Point).x - (max.label as Point).x)).toBeGreaterThan(30);
    expect(reject.laneY).toBe(max.laneY);
  });

  it('a long pill row wraps instead of running under the next card', () => {
    const wide: EdgeData = dataOf(edge('e:d->b'));
    expect(wide.results).toEqual(['REVISE_B']);
    expect(wide.labelMaxWidth).toBeUndefined();
  });
});
