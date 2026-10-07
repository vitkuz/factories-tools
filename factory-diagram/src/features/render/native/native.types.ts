import type { GraphEdge, GraphNode } from '../../graph/index.js';

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A node with the place the Studio layout gave it, in flow space (main row at y = 0). */
export interface PlacedNode {
  node: GraphNode;
  box: Box;
}

/** Which side of a card an edge leaves or enters, and the handle id the Studio names it by. */
export type Side = 'left' | 'right' | 'top' | 'bottom';

export interface Anchor {
  point: Point;
  side: Side;
}

/** A model edge with the geometry the Studio layout decided for it: handles and, on a lane, its y. */
export interface RoutedEdge {
  edge: GraphEdge;
  from: Anchor;
  to: Anchor;
  laneY: number | null;
  /** The points of the orthogonal polyline, source first, target last. */
  points: Point[];
  /** Where the result pills sit. */
  label: Point;
}

export interface Pill {
  text: string;
  /** The result on the happy path: drawn in the happy tone. */
  lit: boolean;
  width: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
