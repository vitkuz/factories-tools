import {
  END_ID,
  START_ID,
  isTerminalId,
  type EdgeData,
  type EdgeKind,
  type EdgeRouteRef,
  type GraphEdge,
  type GraphNodeOf,
  type GraphPipeline,
  type GraphRoute,
  type GraphStep,
  type StepCardData,
  type StepNodeOf,
  type TerminalNodeType,
} from './graph.types';
import { edgeKey, rankPipeline, type PipelineRanks } from './rank';
import { displayDocPath, estimateSansWidth, wrappedLineCount } from './text';

/**
 * The pipeline graph's layout, shared by the Runs screen and the Editor: a DFS rank, one
 * column per rank, fan-out siblings stacked under the main-row card, loops and jumps on
 * lanes below and above the row. Pure functions returning new objects; colours are never
 * literal here — every tone is a CSS class.
 */

/* ---- sizes shared with the CSS (nodes are fixed-size so fitView works before measuring) */
export const NODE_W = 156;
export const NODE_H = 104;
export const START_W = 60;
export const END_W = 52;
export const TERM_H = 28;
export const STEP_GAP = 72;
/** Start → first card: the edge carries no pill, so it needs no label room. */
export const TERM_GAP = 36;
export const END_GAP = 80;
/** Vertical gap between stacked cards in one column — room for a callout (32) and a rule. */
export const STACK_GAP = 56;
/** Lanes: first lane distance from the cards (64 clears a 24 px screen-sized callout down to zoom 0.6), and pitch between parallel lanes. */
export const LANE_ABOVE = 64;
export const LANE_BELOW = 40;
export const LANE_PITCH = 32;

/* ---- detailed-card metrics (must match `.step-node` CSS) */
/** Characters per line of 11 px Plex Mono in the 128 px card content width. */
export const MONO_COLS = 19;
const BASE_H = 103; // border 4 + padding 20 + head 20 + agent 20 + model 16 + footer 23 (human cards print "waits for a person" on the model line, so they share it)
const DURATION_H = 20; // margin 4 + line 16
const DOCS_MARGIN = 8;
const DOC_LINE_H = 14;
const DOC_GROUP_GAP = 4;
const FOOT_MARGIN = 8;

/* ---- handle ids (unique per node, one per direction) */
export const HANDLE = {
  in: 'in',
  out: 'out',
  loopOut: 'loop-out',
  loopIn: 'loop-in',
  maxOut: 'max-out',
  maxIn: 'max-in',
  jumpOut: 'jump-out',
  jumpIn: 'jump-in',
} as const;

export const HUMAN_AGENT = 'human';

/* ---- edge ids: `e:source->target`, and `:max` for an escape (never collides with a route) */
export const forwardEdgeId = (source: string, target: string): string => `e:${source}->${target}`;
export const maxEdgeId = (source: string, target: string): string => `e:${source}->${target}:max`;

/**
 * The retry cap the step carries. It is declared per event — the one event that loops back
 * — so the step's cap is the first (and in practice only) one any of its routes sets.
 */
export const stepMax = (step: GraphStep | undefined): number | undefined =>
  Object.values(step?.transitions ?? {}).find((route: GraphRoute) => route.max != null)?.max;

/** The event that carries the cap, and where the step goes once that cap is spent. */
const cappedRoute = (step: GraphStep | undefined): [string, GraphRoute] | undefined =>
  Object.entries(step?.transitions ?? {}).find(
    ([, route]: [string, GraphRoute]) => route.max != null,
  );

export const stepOnMax = (step: GraphStep | undefined): string[] =>
  cappedRoute(step)?.[1].onMax ?? [];

/** Lines the doc block of a detailed card needs: one label line per group plus one per wrapped path. */
const docLines = (paths: readonly string[]): number => 1 + wrappedLineCount(paths, MONO_COLS);

/**
 * Card height for a mode — the same arithmetic the CSS produces, so nothing is clipped.
 * The knowledge group takes no room at all when the step has no knowledge files (its
 * paths wrap as displayed, without the `{{skillPath}}` template), and a card without a
 * duration line (no run state) makes no room for one.
 */
export const stepNodeHeight = (
  data: Pick<StepCardData, 'inputs' | 'outputs' | 'knowledge' | 'detailed'>,
  hasDuration: boolean,
): number => {
  if (!data.detailed) return NODE_H;
  const knowledge: string[] = data.knowledge.map(displayDocPath);
  const groups: number = knowledge.length > 0 ? 3 : 2;
  const lines: number =
    docLines(data.inputs) +
    docLines(data.outputs) +
    (knowledge.length > 0 ? docLines(knowledge) : 0);
  const docs: number = lines * DOC_LINE_H + DOC_GROUP_GAP * (groups - 1);
  const duration: number = hasDuration ? DURATION_H : 0;
  return BASE_H + duration + DOCS_MARGIN + docs + FOOT_MARGIN + 1;
};

/* ------------------------------------------------------------------ nodes */

interface Column {
  rank: number;
  slugs: string[];
}

/** One column per rank, main-row node first (DFS order), then the stacked ones. */
const columnsOf = (ranks: PipelineRanks): Column[] => {
  const byRank: Map<number, string[]> = new Map();
  for (const slug of ranks.order) {
    const r: number = ranks.rank[slug] ?? 1;
    byRank.set(r, [...(byRank.get(r) ?? []), slug]);
  }
  return [...byRank.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rank, slugs]): Column => ({ rank, slugs }));
};

/** Widest one-row label between two adjacent columns, so a `DONE FAIL` pill row never touches a card. */
const labelWidthBetween = (
  pipeline: GraphPipeline,
  ranks: PipelineRanks,
  from: number,
  to: number,
): number =>
  Math.max(
    0,
    ...Object.entries(pipeline.steps).flatMap(([slug, step]: [string, GraphStep]): number[] => {
      if (ranks.rank[slug] !== from) return [];
      const byTarget: Record<string, string[]> = Object.entries(step.transitions).reduce(
        (
          acc: Record<string, string[]>,
          [result, route]: [string, GraphRoute],
        ): Record<string, string[]> =>
          route.target.reduce(
            (inner: Record<string, string[]>, t: string): Record<string, string[]> => ({
              ...inner,
              [t]: [...(inner[t] ?? []), result],
            }),
            acc,
          ),
        {},
      );
      return Object.entries(byTarget)
        .filter(([t]) => ranks.rank[t] === to && !ranks.back.has(edgeKey(slug, t)))
        .map(([, results]) => pillRowWidth(results));
    }),
  );

/** Estimated width of a row of result pills (6 px padding each side, 4 px between). */
export const pillRowWidth = (results: readonly string[]): number =>
  results.reduce((w: number, r: string): number => w + estimateSansWidth(r) + 12, 0) +
  Math.max(0, results.length - 1) * 4;

/**
 * Columns left to right: START, one column per rank, END. The main-row card of each
 * column is centred on the row line (y = 0) so forward edges stay horizontal; extra
 * cards stack below it. Column gaps grow when a wide pill row has to fit between them.
 * `toData` builds each card's data and `heightOf` is its card height.
 */
export const layoutNodes = <D extends StepCardData>(
  pipeline: GraphPipeline,
  ranks: PipelineRanks,
  toData: (slug: string, stackIndex: number) => D,
  heightOf: (data: D) => number,
): GraphNodeOf<D>[] => {
  const columns: Column[] = columnsOf(ranks);

  const start: TerminalNodeType = {
    id: START_ID,
    type: 'start',
    position: { x: 0, y: -TERM_H / 2 },
    width: START_W,
    height: TERM_H,
    data: { label: 'Start' },
  };

  let x: number = START_W + TERM_GAP;
  const steps: StepNodeOf<D>[] = [];
  columns.forEach((column: Column, ci: number): void => {
    let y: number = 0;
    column.slugs.forEach((slug: string, i: number): void => {
      const data: D = toData(slug, i);
      const height: number = heightOf(data);
      const top: number = i === 0 ? -height / 2 : y;
      steps.push({ id: slug, type: 'step', position: { x, y: top }, width: NODE_W, height, data });
      y = top + height + STACK_GAP;
    });
    const next: Column | undefined = columns[ci + 1];
    const labelW: number = next
      ? labelWidthBetween(pipeline, ranks, column.rank, next.rank)
      : labelWidthBetween(pipeline, ranks, column.rank, ranks.rank[END_ID]);
    const gap: number = Math.max(next ? STEP_GAP : END_GAP, labelW + 24);
    x += NODE_W + gap;
  });

  const end: TerminalNodeType = {
    id: END_ID,
    type: 'end',
    position: { x, y: -TERM_H / 2 },
    width: END_W,
    height: TERM_H,
    data: { label: 'End' },
  };
  return [start, ...steps, end];
};

/** Ids of the cards stacked under a main-row card (lane edges into them use the left handle). */
export const stackedIds = <D extends StepCardData>(nodes: readonly GraphNodeOf<D>[]): Set<string> =>
  new Set<string>(
    nodes.flatMap((n: GraphNodeOf<D>): string[] =>
      n.type === 'step' && n.data.stackIndex > 0 ? [n.id] : [],
    ),
  );

/* ------------------------------------------------------------------ edges */

interface RouteGroup {
  source: string;
  target: string;
  results: string[];
}

/** A target that exists: a step, or END. A dangling target (an editor in progress) draws nothing. */
const knownTarget =
  (pipeline: GraphPipeline) =>
  (target: string): boolean =>
    target === END_ID || target in pipeline.steps;

const groupRoutes = (pipeline: GraphPipeline): RouteGroup[] =>
  Object.values(
    Object.entries(pipeline.steps).reduce(
      (
        acc: Record<string, RouteGroup>,
        [slug, step]: [string, GraphStep],
      ): Record<string, RouteGroup> =>
        Object.entries(step.transitions).reduce(
          (
            inner: Record<string, RouteGroup>,
            [result, route]: [string, GraphRoute],
          ): Record<string, RouteGroup> =>
            route.target
              .filter(knownTarget(pipeline))
              .reduce(
                (deep: Record<string, RouteGroup>, target: string): Record<string, RouteGroup> => {
                  const key: string = edgeKey(slug, target);
                  const prev: RouteGroup = deep[key] ?? { source: slug, target, results: [] };
                  return { ...deep, [key]: { ...prev, results: [...prev.results, result] } };
                },
                inner,
              ),
          acc,
        ),
      {},
    ),
  );

const blankData = (
  kind: EdgeKind,
  results: string[],
  routes: EdgeRouteRef[],
  loop: boolean,
  jump: boolean,
): EdgeData => ({
  kind,
  results,
  routes,
  loop,
  jump,
  lane: kind === 'max' || jump ? 'above' : loop ? 'below' : 'row',
  traversals: 0,
  taken: false,
  takenResults: [],
  tone: 'completed',
  bypassed: false,
  live: false,
});

const handlesFor = (
  data: EdgeData,
  target: string,
  targetStacked: boolean,
): Pick<GraphEdge, 'sourceHandle' | 'targetHandle'> => {
  if (data.kind === 'max') {
    return {
      sourceHandle: HANDLE.maxOut,
      targetHandle: isTerminalId(target) || targetStacked ? HANDLE.in : HANDLE.maxIn,
    };
  }
  if (data.jump) {
    return {
      sourceHandle: HANDLE.jumpOut,
      targetHandle: isTerminalId(target) || targetStacked ? HANDLE.in : HANDLE.jumpIn,
    };
  }
  if (data.loop) return { sourceHandle: HANDLE.loopOut, targetHandle: HANDLE.loopIn };
  return { sourceHandle: HANDLE.out, targetHandle: HANDLE.in };
};

/** Every routing edge: START → entry, `on` routes grouped per (source, target), `onMax` escapes. */
export const buildEdges = (
  pipeline: GraphPipeline,
  ranks: PipelineRanks,
  stacked: ReadonlySet<string>,
): GraphEdge[] => {
  const make = (id: string, source: string, target: string, data: EdgeData): GraphEdge => ({
    id,
    source,
    target,
    type: 'flow',
    ...handlesFor(data, target, stacked.has(target)),
    data,
    focusable: false,
  });
  const span = (s: string, t: string): number => (ranks.rank[t] ?? 0) - (ranks.rank[s] ?? 0);

  const start: GraphEdge[] = pipeline.START.filter((slug: string): boolean =>
    knownTarget(pipeline)(slug),
  ).map((slug: string): GraphEdge =>
    make(
      forwardEdgeId(START_ID, slug),
      START_ID,
      slug,
      blankData('start', ['start'], [], false, false),
    ),
  );
  const routes: GraphEdge[] = groupRoutes(pipeline).map((g: RouteGroup): GraphEdge => {
    const loop: boolean = ranks.back.has(edgeKey(g.source, g.target));
    const jump: boolean = !loop && span(g.source, g.target) > 1;
    const refs: EdgeRouteRef[] = g.results.map((event: string): EdgeRouteRef => ({
      event,
      target: g.target,
      isFallback: false,
    }));
    return make(
      forwardEdgeId(g.source, g.target),
      g.source,
      g.target,
      blankData('route', g.results, refs, loop, jump),
    );
  });
  const escapes: GraphEdge[] = Object.entries(pipeline.steps).flatMap(
    ([slug, step]: [string, GraphStep]): GraphEdge[] => {
      const capped: [string, GraphRoute] | undefined = cappedRoute(step);
      if (!capped) return [];
      return (capped[1].onMax ?? [])
        .filter(knownTarget(pipeline))
        .map((target: string): GraphEdge =>
          make(
            maxEdgeId(slug, target),
            slug,
            target,
            blankData(
              'max',
              ['max'],
              [{ event: capped[0], target, isFallback: true }],
              false,
              false,
            ),
          ),
        );
    },
  );
  return [...start, ...routes, ...escapes];
};

/* ------------------------------------------------------------------ lanes */

interface Bounds {
  top: number;
  bottom: number;
}

interface LaneRequest {
  index: number;
  lo: number;
  hi: number;
}

/** Greedy interval colouring: shorter spans get the lanes nearest the row. */
const allocateLanes = (requests: readonly LaneRequest[]): Map<number, number> => {
  const ordered: LaneRequest[] = [...requests].sort(
    (a, b) => a.hi - a.lo - (b.hi - b.lo) || a.lo - b.lo,
  );
  const lanes: LaneRequest[][] = [];
  const assigned: Map<number, number> = new Map();
  for (const req of ordered) {
    const free: number = lanes.findIndex((lane) =>
      lane.every((o) => o.hi < req.lo || o.lo > req.hi),
    );
    const lane: number = free === -1 ? lanes.length : free;
    if (free === -1) lanes.push([]);
    lanes[lane].push(req);
    assigned.set(req.index, lane);
  }
  return assigned;
};

/**
 * Give every above/below edge a lane y that clears all cards in the columns it spans
 * (and any callout above them), stacking parallel lanes outward from the row.
 */
export const assignLanes =
  <D extends StepCardData>(nodes: readonly GraphNodeOf<D>[], ranks: PipelineRanks) =>
  (edges: readonly GraphEdge[]): GraphEdge[] => {
    const rankOf = (id: string): number => ranks.rank[id] ?? 0;
    const bounds: Map<number, Bounds> = new Map();
    for (const n of nodes) {
      const r: number = rankOf(n.id);
      const h: number = n.height ?? NODE_H;
      const prev: Bounds = bounds.get(r) ?? { top: Infinity, bottom: -Infinity };
      bounds.set(r, {
        top: Math.min(prev.top, n.position.y),
        bottom: Math.max(prev.bottom, n.position.y + h),
      });
    }
    const extent = (lo: number, hi: number): Bounds => {
      let top: number = Infinity;
      let bottom: number = -Infinity;
      for (let r = lo; r <= hi; r += 1) {
        const b: Bounds | undefined = bounds.get(r);
        if (!b) continue;
        top = Math.min(top, b.top);
        bottom = Math.max(bottom, b.bottom);
      }
      return { top: Number.isFinite(top) ? top : 0, bottom: Number.isFinite(bottom) ? bottom : 0 };
    };
    const request = (e: GraphEdge, i: number): LaneRequest => {
      const a: number = rankOf(e.source);
      const b: number = rankOf(e.target);
      return { index: i, lo: Math.min(a, b), hi: Math.max(a, b) };
    };
    const above: Map<number, number> = allocateLanes(
      edges.flatMap((e, i) => (e.data?.lane === 'above' ? [request(e, i)] : [])),
    );
    const below: Map<number, number> = allocateLanes(
      edges.flatMap((e, i) => (e.data?.lane === 'below' ? [request(e, i)] : [])),
    );

    return edges.map((e: GraphEdge, i: number): GraphEdge => {
      const data: EdgeData = e.data as EdgeData;
      if (data.lane === 'row') return e;
      const { lo, hi } = request(e, i);
      const ext: Bounds = extent(lo, hi);
      const laneY: number =
        data.lane === 'above'
          ? ext.top - LANE_ABOVE - (above.get(i) ?? 0) * LANE_PITCH
          : ext.bottom + LANE_BELOW + (below.get(i) ?? 0) * LANE_PITCH;
      return { ...e, data: { ...data, laneY } };
    });
  };

/* ------------------------------------------------------------------ decoration */

/** The one structural class every edge carries: what it is, before anything about a run. */
export const structuralEdgeClass = (data: EdgeData): string =>
  data.kind === 'max'
    ? 'edge-max'
    : data.loop
      ? 'edge-loop'
      : data.jump
        ? 'edge-jump'
        : 'edge-forward';

/**
 * The event a step takes when all goes well: its first-declared event that leads
 * somewhere forward (an event that only loops back is a retry, not the happy path).
 */
const happyEvent =
  (pipeline: GraphPipeline, ranks: PipelineRanks) =>
  (slug: string): string | undefined =>
    Object.entries(pipeline.steps[slug]?.transitions ?? {}).find(
      ([, route]: [string, GraphRoute]): boolean =>
        route.target.some((t: string): boolean => !ranks.back.has(edgeKey(slug, t))),
    )?.[0];

/**
 * Without run data, the lit ("taken") path is: Start edges, and each step's happy event.
 * Loops, max escapes and every other event stay grey, dashed where a loop or jump is dashed.
 */
export const highlightHappyPath =
  (pipeline: GraphPipeline, ranks: PipelineRanks) =>
  (edges: readonly GraphEdge[]): GraphEdge[] => {
    const happy = happyEvent(pipeline, ranks);
    return edges.map((e: GraphEdge): GraphEdge => {
      const base: EdgeData = e.data as EdgeData;
      const first: string | undefined =
        base.kind === 'route' && !base.loop ? happy(e.source) : undefined;
      const takenResults: string[] =
        base.kind === 'start'
          ? base.results
          : first !== undefined && base.results.includes(first)
            ? [first]
            : [];
      const data: EdgeData = { ...base, taken: takenResults.length > 0, takenResults };
      const classes: string[] = [
        structuralEdgeClass(data),
        data.results.includes('SKIP') ? 'edge-skip' : '',
        data.taken ? 'edge-taken' : '',
      ].filter(Boolean);
      return { ...e, data, className: classes.join(' ') };
    });
  };

/** Nodes and edges of a pipeline definition: laid out, laned and lit along the happy path. */
export const buildDefinitionGraph = <D extends StepCardData>(
  pipeline: GraphPipeline,
  toData: (slug: string, stackIndex: number) => D,
  heightOf: (data: D) => number,
): { nodes: GraphNodeOf<D>[]; edges: GraphEdge[] } => {
  const ranks: PipelineRanks = rankPipeline(pipeline);
  const nodes: GraphNodeOf<D>[] = layoutNodes(pipeline, ranks, toData, heightOf);
  const edges: GraphEdge[] = highlightHappyPath(
    pipeline,
    ranks,
  )(assignLanes(nodes, ranks)(buildEdges(pipeline, ranks, stackedIds(nodes))));
  return { nodes, edges };
};
