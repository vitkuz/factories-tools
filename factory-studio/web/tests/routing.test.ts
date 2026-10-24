import { describe, expect, it } from 'vitest';
import {
  END_ID,
  forwardEdgeId,
  lastHeading,
  maxEdgeId,
  roundedPath,
  routeGraph,
  simplifyPoints,
  START_ID,
  type EdgeData,
  type GraphEdge,
  type GridCard,
  type Point,
  type RoutedGraph,
} from '../src/shared/graph';

/* ------------------------------------------------------------------ a hand-made grid */

const card = (id: string, col: number, row: number): GridCard => ({
  id,
  col,
  row,
  width: 100,
  height: 50,
});

const blank = (overrides: Partial<EdgeData>): EdgeData => ({
  kind: 'route',
  results: ['DONE'],
  routes: [],
  loop: false,
  jump: false,
  lane: 'row',
  traversals: 0,
  taken: false,
  takenResults: [],
  tone: 'completed',
  bypassed: false,
  live: false,
  quiet: false,
  ...overrides,
});

const edge = (source: string, target: string, data: Partial<EdgeData> = {}): GraphEdge => ({
  id: data.kind === 'max' ? maxEdgeId(source, target) : forwardEdgeId(source, target),
  source,
  target,
  type: 'flow',
  data: blank(data),
});

/**
 *   START → a → b → END
 *              ↘ c (row 1)
 *   b → a is a loop; a → END:max an escape; c → b a loop from a lower row.
 */
const cards: GridCard[] = [
  { id: START_ID, col: 0, row: 0, width: 60, height: 28 },
  card('a', 1, 0),
  card('b', 2, 0),
  card('c', 2, 1),
  { id: END_ID, col: 3, row: 0, width: 52, height: 28 },
];
const edges: GraphEdge[] = [
  edge(START_ID, 'a', { kind: 'start', results: ['start'] }),
  edge('a', 'b'),
  edge('a', 'c'),
  edge('b', END_ID),
  edge('b', 'a', { loop: true, lane: 'below', results: ['RETRY'] }),
  edge('c', 'b', { loop: true, lane: 'below', results: ['AGAIN'] }),
  edge('a', END_ID, { kind: 'max', results: ['max'], lane: 'above', jump: true }),
];
const routed: RoutedGraph = routeGraph(cards, edges, {
  stackGap: 40,
  channelWidth: (): number => 60,
});
const points = (id: string): Point[] => {
  const found: GraphEdge | undefined = routed.edges.find((e: GraphEdge): boolean => e.id === id);
  if (!found) throw new Error(`no edge ${id}`);
  return simplifyPoints((found.data as EdgeData).points ?? []);
};

describe('routeGraph', () => {
  it('places START and END on the main row and stacks c under b', () => {
    expect(routed.positions[START_ID].y).toBe(-14);
    expect(routed.positions.a).toEqual({ x: 120, y: -25 });
    expect(routed.positions.b.y).toBe(-25);
    expect(routed.positions.c.x).toBe(routed.positions.b.x);
    expect(routed.positions.c.y).toBeGreaterThanOrEqual(25 + 40);
    expect(routed.positions[END_ID].x).toBeGreaterThan(routed.positions.b.x + 100);
  });

  it('draws a same-row edge straight and a fan-out edge with one bend in the channel', () => {
    expect(points(forwardEdgeId('a', 'b'))).toEqual([
      { x: 220, y: 0 },
      { x: routed.positions.b.x, y: 0 },
    ]);
    const bent: Point[] = points(forwardEdgeId('a', 'c'));
    expect(bent).toHaveLength(4);
    expect(bent[1].x).toBe(bent[2].x);
    expect(bent[1].x).toBeGreaterThan(220);
    expect(bent[1].x).toBeLessThan(routed.positions.b.x);
    expect(bent[3]).toEqual({ x: routed.positions.c.x, y: routed.positions.c.y + 25 });
  });

  it('routes a same-row loop under the cards, between the two columns', () => {
    const pts: Point[] = points(forwardEdgeId('b', 'a'));
    expect(pts).toHaveLength(4);
    expect(pts[0]).toEqual({ x: routed.positions.b.x + 80, y: 25 });
    expect(pts[3]).toEqual({ x: 140, y: 25 });
    expect(pts[1].y).toBe(pts[2].y);
    expect(pts[1].y).toBeGreaterThan(25);
    expect(pts[1].y).toBeLessThan(routed.positions.c.y);
  });

  it('routes a loop from a lower row up through the channel right of its target', () => {
    const pts: Point[] = points(forwardEdgeId('c', 'b'));
    expect(pts).toHaveLength(6);
    const channelX: number = pts[2].x;
    expect(channelX).toBeGreaterThan(routed.positions.b.x + 100);
    expect(channelX).toBeLessThan(routed.positions[END_ID].x);
    expect(pts[1].y).toBeGreaterThan(routed.positions.c.y + 50);
    expect(pts[3].y).toBeGreaterThan(25);
    expect(pts[3].y).toBeLessThan(routed.positions.c.y);
    expect(pts[5]).toEqual({ x: routed.positions.b.x + 20, y: 25 });
  });

  it('takes an escape to END over the top and in from the left', () => {
    const pts: Point[] = points(maxEdgeId('a', END_ID));
    expect(pts[0]).toEqual({ x: 140, y: -25 });
    expect(pts[1].y).toBeLessThan(-25);
    expect(pts[pts.length - 1]).toEqual({ x: routed.positions[END_ID].x, y: 0 });
    expect(routed.bounds.y).toBeLessThan(-25);
  });

  it('keeps the laneY of an off-row edge on its first horizontal', () => {
    const loop: GraphEdge | undefined = routed.edges.find(
      (e: GraphEdge): boolean => e.id === forwardEdgeId('c', 'b'),
    );
    expect((loop?.data as EdgeData).laneY).toBe(points(forwardEdgeId('c', 'b'))[1].y);
  });
});

/* ------------------------------------------------------------------ drawing helpers */

describe('simplifyPoints', () => {
  it('drops repeats and the middle of a straight run', () => {
    expect(
      simplifyPoints([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 4 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
    ]);
  });
});

describe('roundedPath', () => {
  it('is a straight line for two points', () => {
    expect(
      roundedPath(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        6,
      ),
    ).toBe('M 0 0 L 10 0');
  });

  it('rounds a corner with a quadratic curve, and less on a short run', () => {
    expect(
      roundedPath(
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
        ],
        6,
      ),
    ).toBe('M 0 0 L 14 0 Q 20 0 20 6 L 20 20');
    expect(
      roundedPath(
        [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 20 },
        ],
        6,
      ),
    ).toBe('M 0 0 L 2 0 Q 4 0 4 2 L 4 20');
  });
});

describe('lastHeading', () => {
  it('reads the direction of the final run', () => {
    expect(
      lastHeading([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ]),
    ).toBe('right');
    expect(
      lastHeading([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: -3 },
      ]),
    ).toBe('up');
    expect(
      lastHeading([
        { x: 5, y: 0 },
        { x: 0, y: 0 },
      ]),
    ).toBe('left');
    expect(lastHeading([{ x: 1, y: 1 }])).toBe('right');
  });
});
