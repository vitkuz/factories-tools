import {
  END_ID,
  START_ID,
  type GraphPipeline,
  type GraphRoute,
  type GraphStep,
} from './graph.types';

/**
 * Topological ranking of a pipeline for a left-to-right layout.
 *
 * A depth-first walk from START classifies every routing edge: an edge whose target is
 * still on the DFS stack is a **back edge** (a loop); every other edge is forward. Over
 * the forward edges alone the graph is a DAG, and each step's rank is its longest
 * distance from START. A shortcut (`research → final` via `SKIP`) therefore never pulls
 * its target into an earlier column, and a forward edge between two steps is never
 * mistaken for a loop just because both sit at the same BFS depth.
 */

export interface PipelineRanks {
  /** Longest-path rank per step; START is 0, END is `maxRank + 1`. */
  rank: Record<string, number>;
  /** `"source->target"` keys of back edges (loops). */
  back: ReadonlySet<string>;
  /** Steps in DFS discovery order — the primary route first, so it becomes the main row. */
  order: string[];
}

export const edgeKey = (source: string, target: string): string => `${source}->${target}`;

/** Every routing target of a step in declaration order: each event's `target`, then its `onMax`. */
export const targetsOf =
  (pipeline: GraphPipeline) =>
  (slug: string): string[] => {
    if (slug === START_ID) return [...new Set(pipeline.START)];
    const step: GraphStep | undefined = pipeline.steps[slug];
    if (!step) return [];
    return [
      ...new Set(
        Object.values(step.transitions).flatMap((route: GraphRoute): string[] => [
          ...route.target,
          ...(route.onMax ?? []),
        ]),
      ),
    ];
  };

export const rankPipeline = (pipeline: GraphPipeline): PipelineRanks => {
  const targets = targetsOf(pipeline);
  const onStack = new Set<string>();
  const visited = new Set<string>();
  const back = new Set<string>();
  const order: string[] = [];

  const walk = (node: string): void => {
    visited.add(node);
    onStack.add(node);
    if (node !== START_ID) order.push(node);
    for (const t of targets(node)) {
      if (t === END_ID) continue;
      if (!(t in pipeline.steps)) continue;
      if (onStack.has(t)) back.add(edgeKey(node, t));
      else if (!visited.has(t)) walk(t);
    }
    onStack.delete(node);
  };
  walk(START_ID);

  // Steps unreachable from START still need a place: walk them too (they rank from 1).
  for (const slug of Object.keys(pipeline.steps)) if (!visited.has(slug)) walk(slug);

  const rank: Record<string, number> = { [START_ID]: 0 };
  const preds: Record<string, string[]> = {};
  for (const s of [START_ID, ...Object.keys(pipeline.steps)]) {
    for (const t of targets(s)) {
      if (t === END_ID || !(t in pipeline.steps) || back.has(edgeKey(s, t))) continue;
      preds[t] = [...(preds[t] ?? []), s];
    }
  }
  const rankOf = (slug: string, trail: ReadonlySet<string>): number => {
    if (rank[slug] !== undefined) return rank[slug];
    if (trail.has(slug)) return 1; // defensive: cannot happen once back edges are removed
    const ps: string[] = preds[slug] ?? [];
    const next = new Set<string>([...trail, slug]);
    const r: number = ps.length === 0 ? 1 : Math.max(...ps.map((p) => rankOf(p, next) + 1));
    rank[slug] = r;
    return r;
  };
  for (const slug of Object.keys(pipeline.steps)) rankOf(slug, new Set());
  rank[END_ID] = Math.max(0, ...Object.keys(pipeline.steps).map((s) => rank[s])) + 1;

  return { rank, back, order };
};

/** True when `source → target` is a loop in this pipeline (rank-based, never by depth). */
export const isBackEdge =
  (ranks: PipelineRanks) =>
  (source: string, target: string): boolean =>
    ranks.back.has(edgeKey(source, target));
