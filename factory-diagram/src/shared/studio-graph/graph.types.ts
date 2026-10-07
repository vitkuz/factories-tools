// Copied verbatim from factories-tools/factory-studio/web/src/shared/graph/graph.types.ts — do not edit here.
// tests/studio-sync.test.ts fails when the two drift: change the Studio file and copy it again
// (the only edits the copy script makes are the `.js` import extensions this ESM build needs).

import type { Edge, Node } from './xyflow.types.js';

/**
 * The pipeline graph as both screens draw it. These are the structural parts of a
 * `pipeline.json` the layout reads — the Runs screen's Zod-parsed pipeline and the
 * editor's own model both satisfy them, so one layout serves both.
 */

export interface GraphRoute {
  target: string[];
  max?: number;
  onMax?: string[];
}

export interface GraphStep {
  agent: string;
  transitions: Record<string, GraphRoute>;
}

export interface GraphPipeline {
  START: string[];
  steps: Record<string, GraphStep>;
}

/** Node ids of the two terminals. A step is never called this. */
export const START_ID = 'START';
export const END_ID = 'END';

export const isTerminalId = (id: string): boolean => id === START_ID || id === END_ID;

/** What every step card's data carries, whatever else the screen adds. */
export interface StepCardData extends Record<string, unknown> {
  slug: string;
  agent: string;
  /** Model line of the card; `null` for a human step. */
  model: string | null;
  /** `agent === 'human'` — a person, not a subagent. */
  human: boolean;
  max?: number;
  inputs: string[];
  outputs: string[];
  knowledge: string[];
  /** Card mode the node was laid out for. */
  detailed: boolean;
  /** 0 for the main-row node of a column, 1+ for nodes stacked under it. */
  stackIndex: number;
}

export type TerminalNodeData = {
  label: string;
};

export type StepNodeOf<D extends StepCardData> = Node<D, 'step'>;
export type TerminalNodeType = Node<TerminalNodeData, 'start' | 'end'>;
export type GraphNodeOf<D extends StepCardData> = StepNodeOf<D> | TerminalNodeType;

export type EdgeKind = 'start' | 'route' | 'max';

/** Where an edge is drawn: on the row, or along a lane above / below it. */
export type EdgeLane = 'row' | 'above' | 'below';

/** One `transitions` entry an edge stands for: the event, and whether it is the `onMax` fallback. */
export interface EdgeRouteRef {
  event: string;
  target: string;
  isFallback: boolean;
}

export type EdgeData = {
  kind: EdgeKind;
  /** Result slugs that route along this edge (`['max']` / `['start']` for the others). */
  results: string[];
  /** The pipeline entries this edge draws, one per result (none for a START edge). */
  routes: EdgeRouteRef[];
  /** Back edge by rank (a real loop): drawn under the row. */
  loop: boolean;
  /** Forward edge spanning more than one column (a shortcut): drawn above the row. */
  jump: boolean;
  lane: EdgeLane;
  /** Flow-space y of the lane's horizontal segment (undefined for row edges). */
  laneY?: number;
  /** Times the run went along this edge (from logs, else from final results). */
  traversals: number;
  taken: boolean;
  /** Results that were actually travelled, in `results` order. */
  takenResults: string[];
  /** Taken tone: the completed green, or the skipped tone for a SKIP route. */
  tone: 'completed' | 'skipped';
  /** Untaken edge touching a skipped step — dimmed. */
  bypassed: boolean;
  /** The comet: only the edge into the current step while the run is running. */
  live: boolean;
  /** Hover focus is on other nodes: the edge and its label are dimmed (set by the canvas). */
  dimmed?: boolean;
};

export type GraphEdge = Edge<EdgeData, 'flow'>;
