import {
  END_ID,
  START_ID,
  isTerminalId,
  type Box,
  type EdgeData,
  type EdgeKind,
  type EdgeRouteRef,
  type GraphEdge,
  type GraphNodeOf,
  type GraphPipeline,
  type GraphRoute,
  type GraphStep,
  type Point,
  type StepCardData,
} from './graph.types';
import { edgeKey, happyEvent, rankPipeline, type PipelineRanks } from './rank';
import { routeGraph, type GridCard, type RoutedGraph } from './route';
import { displayDocPath, pillRowWidth, wrappedLineCount } from './text';

/**
 * The pipeline graph's layout, shared by the Runs screen and the Editor: one column per wave
 * (see `rank.ts`), the main-row card of a wave on the row line and its siblings stacked under
 * it in rows aligned across columns; every edge routed orthogonally through the gaps between
 * rows and the channels between columns (see `route.ts`). Pure functions returning new
 * objects; colours are never literal here — every tone is a CSS class.
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
/** Vertical gap between stacked rows — room for a callout (32) and a rule; grows with the lanes it carries. */
export const STACK_GAP = 56;

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

/** One column per wave, in `ranks.order`: the main-row card first, then the stacked ones. */
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

/** Nodes and edges of a laid-out graph, and the box they occupy (lanes included). */
export interface LaidOutGraph<D extends StepCardData> {
  nodes: GraphNodeOf<D>[];
  edges: GraphEdge[];
  bounds: Box;
}

/**
 * Columns left to right: START, one column per rank, END. Rows are aligned across columns,
 * the main-row card of each column centred on the row line (y = 0) so forward edges stay
 * horizontal, its siblings stacked below it. Column gaps grow when a wide pill row or several
 * trunks have to fit between them; row gaps grow with the lanes routed through them.
 * `toData` builds each card's data and `heightOf` is its card height.
 */
export const layoutGraph = <D extends StepCardData>(
  pipeline: GraphPipeline,
  ranks: PipelineRanks,
  toData: (slug: string, stackIndex: number) => D,
  heightOf: (data: D) => number,
): LaidOutGraph<D> => {
  const columns: Column[] = columnsOf(ranks);
  const endCol: number = columns.length + 1;
  const data: Map<string, D> = new Map();
  const cards: GridCard[] = [
    { id: START_ID, col: 0, row: 0, width: START_W, height: TERM_H },
    ...columns.flatMap((column: Column, ci: number): GridCard[] =>
      column.slugs.map((slug: string, i: number): GridCard => {
        const d: D = toData(slug, i);
        data.set(slug, d);
        return { id: slug, col: ci + 1, row: i, width: NODE_W, height: heightOf(d) };
      }),
    ),
    { id: END_ID, col: endCol, row: 0, width: END_W, height: TERM_H },
  ];
  const channelWidth = (c: number): number => {
    if (c === 0) return TERM_GAP;
    const from: number = columns[c - 1].rank;
    const next: Column | undefined = columns[c];
    const labelW: number = labelWidthBetween(
      pipeline,
      ranks,
      from,
      next ? next.rank : ranks.rank[END_ID],
    );
    return Math.max(next ? STEP_GAP : END_GAP, labelW + 24);
  };
  const routed: RoutedGraph = routeGraph(cards, buildEdges(pipeline, ranks), {
    stackGap: STACK_GAP,
    channelWidth,
  });
  const positionOf = (id: string): Point => routed.positions[id] ?? { x: 0, y: 0 };
  const nodes: GraphNodeOf<D>[] = cards.map((card: GridCard): GraphNodeOf<D> =>
    isTerminalId(card.id)
      ? {
          id: card.id,
          type: card.id === START_ID ? 'start' : 'end',
          position: positionOf(card.id),
          width: card.width,
          height: card.height,
          data: { label: card.id === START_ID ? 'Start' : 'End' },
        }
      : {
          id: card.id,
          type: 'step',
          position: positionOf(card.id),
          width: card.width,
          height: card.height,
          data: data.get(card.id) as D,
        },
  );
  return { nodes, edges: routed.edges, bounds: routed.bounds };
};

/* ------------------------------------------------------------------ edges */

interface RouteGroup {
  source: string;
  target: string;
  results: string[];
}

/** A target that exists: a step, or END. A dangling target (a pipeline.json mid-edit) draws nothing. */
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
  quiet: false,
});

/**
 * The handles an edge is attached to. The drawn path comes from the layout (`data.points`),
 * so the handles only have to exist: one pair per edge direction, END's single `in`.
 */
const handlesFor = (
  data: EdgeData,
  target: string,
): Pick<GraphEdge, 'sourceHandle' | 'targetHandle'> => {
  if (data.kind === 'max') {
    return {
      sourceHandle: HANDLE.maxOut,
      targetHandle: isTerminalId(target) ? HANDLE.in : HANDLE.maxIn,
    };
  }
  if (data.jump) {
    return {
      sourceHandle: HANDLE.jumpOut,
      targetHandle: isTerminalId(target) ? HANDLE.in : HANDLE.jumpIn,
    };
  }
  if (data.loop) return { sourceHandle: HANDLE.loopOut, targetHandle: HANDLE.loopIn };
  return { sourceHandle: HANDLE.out, targetHandle: HANDLE.in };
};

/** Every routing edge: START → entry, `on` routes grouped per (source, target), `onMax` escapes. */
export const buildEdges = (pipeline: GraphPipeline, ranks: PipelineRanks): GraphEdge[] => {
  const make = (id: string, source: string, target: string, data: EdgeData): GraphEdge => ({
    id,
    source,
    target,
    type: 'flow',
    ...handlesFor(data, target),
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

/** Off the row: a loop, an escape or a jump — what lanes carry. */
export const isOffRow = (data: EdgeData): boolean => data.kind === 'max' || data.loop || data.jump;

/**
 * Untaken loops, escapes and jumps are quiet: they step back (and lose their label) until
 * one of their ends is focused or every route is asked for. Taken ones, and every row edge,
 * stay as they are. Applied after the taken state is known (a run's, or the happy path's).
 */
export const markQuiet = (edges: readonly GraphEdge[]): GraphEdge[] =>
  edges.map((e: GraphEdge): GraphEdge => {
    const data: EdgeData = e.data as EdgeData;
    const quiet: boolean = !data.taken && isOffRow(data);
    return quiet === data.quiet ? e : { ...e, data: { ...data, quiet } };
  });

/**
 * Without run data, the lit ("taken") path is: Start edges, and each step's happy event (see
 * `happyEvent`). Loops, max escapes and every other event stay grey, dashed where a loop or
 * jump is dashed.
 */
export const highlightHappyPath =
  (pipeline: GraphPipeline, ranks: PipelineRanks) =>
  (edges: readonly GraphEdge[]): GraphEdge[] => {
    const happy = happyEvent(pipeline, ranks.back);
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

/** Nodes and edges of a pipeline definition: laid out, routed, lit along the happy path, the rest quiet. */
export const buildDefinitionGraph = <D extends StepCardData>(
  pipeline: GraphPipeline,
  toData: (slug: string, stackIndex: number) => D,
  heightOf: (data: D) => number,
): LaidOutGraph<D> => {
  const ranks: PipelineRanks = rankPipeline(pipeline);
  const laid: LaidOutGraph<D> = layoutGraph(pipeline, ranks, toData, heightOf);
  return { ...laid, edges: markQuiet(highlightHappyPath(pipeline, ranks)(laid.edges)) };
};
