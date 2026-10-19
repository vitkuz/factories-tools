// Copied verbatim from factories-tools/factory-studio/web/src/shared/graph/rank.ts — do not edit here.
// tests/studio-sync.test.ts fails when the two drift: change the Studio file and copy it again
// (the only edits the copy script makes are the `.js` import extensions this ESM build needs).

import {
  END_ID,
  START_ID,
  type GraphPipeline,
  type GraphRoute,
  type GraphStep,
} from './graph.types.js';

/**
 * Waves of a pipeline for a left-to-right layout: one column per wave.
 *
 * A route with `max` is a retry loop. The kit's rule is that every loop closes through a
 * capped route (the validator's `loops-capped`, the recorder's forward walk), so the
 * **forward graph** is every uncapped route's targets plus every `onMax` exit, and the capped
 * targets are the **back edges**. Over the forward graph each step's rank — its wave — is its
 * longest distance from START, so a shortcut (`research → final` via `SKIP`) never pulls its
 * target into an earlier column, and a step runs in the column after the last of its inputs.
 * A pipeline that breaks the rule (an uncapped loop) still draws: a depth-first walk over the
 * forward graph marks the edge that closes such a cycle as a back edge too.
 */

export interface PipelineRanks {
  /** Longest-path wave per step; START is 0, END is `maxRank + 1`. */
  rank: Record<string, number>;
  /** `"source->target"` keys of back edges (loops). */
  back: ReadonlySet<string>;
  /**
   * Steps by wave, left to right; inside a wave the main-row card first, then the rest by the
   * barycentre of their predecessors (declaration order breaks ties).
   */
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

/** Forward targets of a step: every uncapped route's targets, then every `onMax` exit. */
export const forwardTargetsOf =
  (pipeline: GraphPipeline) =>
  (slug: string): string[] => {
    if (slug === START_ID) return [...new Set(pipeline.START)];
    const step: GraphStep | undefined = pipeline.steps[slug];
    if (!step) return [];
    return [
      ...new Set(
        Object.values(step.transitions).flatMap((route: GraphRoute): string[] => [
          ...(route.max == null ? route.target : []),
          ...(route.onMax ?? []),
        ]),
      ),
    ];
  };

/**
 * The loops by definition: `"source->target"` of every capped route's targets — unless the
 * same pair is also an uncapped route, in which case the edge goes forward and only its capped
 * event is a retry.
 */
const cappedEdges = (pipeline: GraphPipeline): Set<string> => {
  const forward = forwardTargetsOf(pipeline);
  return new Set<string>(
    Object.entries(pipeline.steps).flatMap(([slug, step]: [string, GraphStep]): string[] => {
      const ahead: string[] = forward(slug);
      return Object.values(step.transitions).flatMap((route: GraphRoute): string[] =>
        route.max == null
          ? []
          : route.target
              .filter((t: string): boolean => t in pipeline.steps && !ahead.includes(t))
              .map((t: string): string => edgeKey(slug, t)),
      );
    }),
  );
};

/**
 * The event a step takes when all goes well: its first-declared event with a forward target
 * that is a step; failing that, its first event that leads forward at all (to END).
 */
export const happyEvent =
  (pipeline: GraphPipeline, back: ReadonlySet<string>) =>
  (slug: string): string | undefined => {
    const entries: [string, GraphRoute][] = Object.entries(pipeline.steps[slug]?.transitions ?? {});
    const ahead = (t: string): boolean => !back.has(edgeKey(slug, t));
    const toStep: [string, GraphRoute] | undefined = entries.find(([, route]) =>
      route.target.some((t: string): boolean => t in pipeline.steps && ahead(t)),
    );
    const anywhere: [string, GraphRoute] | undefined = entries.find(([, route]) =>
      route.target.some(ahead),
    );
    return (toStep ?? anywhere)?.[0];
  };

/** The main row: from the first START step, each step's happy event's first step target, until END. */
const mainRowOf = (pipeline: GraphPipeline, back: ReadonlySet<string>): Set<string> => {
  const happy = happyEvent(pipeline, back);
  const row = new Set<string>();
  let at: string | undefined = pipeline.START.find((s: string): boolean => s in pipeline.steps);
  while (at !== undefined && !row.has(at)) {
    row.add(at);
    const event: string | undefined = happy(at);
    const route: GraphRoute | undefined =
      event === undefined ? undefined : pipeline.steps[at]?.transitions[event];
    const from: string = at;
    at = route?.target.find(
      (t: string): boolean => t in pipeline.steps && !back.has(edgeKey(from, t)),
    );
  }
  return row;
};

/** Numbers compare by value; two `Infinity` (no predecessors) are equal, never `NaN`. */
const compareNumbers = (a: number, b: number): number => (a === b ? 0 : a < b ? -1 : 1);

/**
 * Steps by wave; in a wave the main-row card first, then by the barycentre of their
 * predecessors' positions in the earlier waves, then by declaration order — the classic
 * layered ordering, so row edges into a stack do not cross each other.
 */
const orderOf = (
  pipeline: GraphPipeline,
  rank: Readonly<Record<string, number>>,
  preds: Readonly<Record<string, string[]>>,
  mainRow: ReadonlySet<string>,
): string[] => {
  const slugs: string[] = Object.keys(pipeline.steps);
  const maxRank: number = Math.max(0, ...slugs.map((s: string): number => rank[s] ?? 1));
  const declared = (s: string): number => slugs.indexOf(s);
  const position: Record<string, number> = {};
  const order: string[] = [];
  for (let wave = 1; wave <= maxRank; wave += 1) {
    const barycentre = (s: string): number => {
      const ps: string[] = (preds[s] ?? []).filter((p: string): boolean => p !== START_ID);
      return ps.length === 0
        ? Infinity
        : ps.reduce((sum: number, p: string): number => sum + (position[p] ?? 0), 0) / ps.length;
    };
    const column: string[] = slugs
      .filter((s: string): boolean => rank[s] === wave)
      .sort(
        (a: string, b: string): number =>
          Number(mainRow.has(b)) - Number(mainRow.has(a)) ||
          compareNumbers(barycentre(a), barycentre(b)) ||
          declared(a) - declared(b),
      );
    column.forEach((s: string, i: number): void => {
      position[s] = i;
      order.push(s);
    });
  }
  return order;
};

export const rankPipeline = (pipeline: GraphPipeline): PipelineRanks => {
  const forward = forwardTargetsOf(pipeline);
  const back = cappedEdges(pipeline);

  // The residual cycles (uncapped loops): a depth-first walk over the forward graph; an edge
  // into a step still on the stack closes one and is a back edge too.
  const onStack = new Set<string>();
  const visited = new Set<string>();
  const walk = (node: string): void => {
    visited.add(node);
    onStack.add(node);
    for (const t of forward(node)) {
      if (t === END_ID || !(t in pipeline.steps) || back.has(edgeKey(node, t))) continue;
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
    for (const t of forward(s)) {
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

  return { rank, back, order: orderOf(pipeline, rank, preds, mainRowOf(pipeline, back)) };
};

/** True when `source → target` is a loop in this pipeline (a capped route, never by depth). */
export const isBackEdge =
  (ranks: PipelineRanks) =>
  (source: string, target: string): boolean =>
    ranks.back.has(edgeKey(source, target));
