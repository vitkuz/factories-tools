import type { HistoryEntry, Pipeline, RunState, Route, StepState } from './types';

/**
 * What the run actually did, read straight out of `state.json`.
 *
 * The state file already counts every route it took — `edges` is a map of `"<step>:<EVENT>"`
 * to how many times the run went that way, and it is what enforces an edge's `max` across a
 * resume. So nothing here reconstructs history from log text: the counters are the history.
 *
 * Everything is pure; `deriveTraversals(pipeline)(state)` is what the graph uses.
 */

import { forwardEdgeId, maxEdgeId, START_ID } from '../../../shared/graph';

export { forwardEdgeId, maxEdgeId };
export const START_EDGE_SOURCE: string = START_ID;

/** Key for "result R travelled along edge E". */
export const resultKey = (edgeId: string, result: string): string => `${edgeId}#${result}`;

export interface Traversals {
  /** Times the run went along each edge id. */
  edges: Record<string, number>;
  /** Times each (edge, result) pair was travelled — see `resultKey`. */
  results: Record<string, number>;
}

export const NO_TRAVERSALS: Traversals = { edges: {}, results: {} };

/** One `"<step>:<EVENT>": n` entry of the state's edge counter. */
interface EdgeCount {
  step: string;
  event: string;
  count: number;
}

/** Split the state's `"<step>:<EVENT>"` keys. A slug never contains a colon, the event may not either. */
export const parseEdgeKey = (key: string): { step: string; event: string } | null => {
  const at: number = key.lastIndexOf(':');
  return at <= 0 ? null : { step: key.slice(0, at), event: key.slice(at + 1) };
};

const edgeCounts = (state: RunState): EdgeCount[] =>
  Object.entries(state.edges).flatMap(([key, count]: [string, number]): EdgeCount[] => {
    const parsed = parseEdgeKey(key);
    return parsed ? [{ ...parsed, count }] : [];
  });

interface Hop {
  edgeId: string;
  result: string;
  count: number;
}

/**
 * Where one recorded event went, and how often. A capped edge spends its `max` traversals on
 * the normal target and sends everything after that to `onMax`, which is how the runner
 * routes once a loop is exhausted.
 */
const hopsFor =
  (pipeline: Pipeline) =>
  ({ step, event, count }: EdgeCount): Hop[] => {
    const route: Route | undefined = pipeline.steps[step]?.transitions[event];
    if (!route) return [];
    const allowed: number = route.max ?? count;
    const normal: number = Math.min(count, allowed);
    const overflow: number = Math.max(0, count - allowed);
    return [
      ...route.target.map((target: string): Hop => ({
        edgeId: forwardEdgeId(step, target),
        result: event,
        count: normal,
      })),
      ...(overflow > 0
        ? (route.onMax ?? []).map((target: string): Hop => ({
            edgeId: maxEdgeId(step, target),
            result: 'max',
            count: overflow,
          }))
        : []),
    ].filter((hop: Hop) => hop.count > 0);
  };

const add = (acc: Record<string, number>, id: string, n: number): Record<string, number> => ({
  ...acc,
  [id]: (acc[id] ?? 0) + n,
});

/** Traversal counts per edge and per (edge, result), from the state's own edge counters. */
export const deriveTraversals =
  (pipeline: Pipeline) =>
  (state: RunState | null): Traversals => {
    if (!state) return NO_TRAVERSALS;
    const hops: Hop[] = edgeCounts(state).flatMap(hopsFor(pipeline));
    const started: boolean = state.status !== 'IDLE';
    const startHops: Hop[] = started
      ? pipeline.START.map((slug: string): Hop => ({
          edgeId: forwardEdgeId(START_EDGE_SOURCE, slug),
          result: 'start',
          count: 1,
        }))
      : [];
    return [...startHops, ...hops].reduce(
      (acc: Traversals, hop: Hop): Traversals => ({
        edges: add(acc.edges, hop.edgeId, hop.count),
        results: add(acc.results, resultKey(hop.edgeId, hop.result), hop.count),
      }),
      NO_TRAVERSALS,
    );
  };

/* ------------------------------------------------------------------ the run history */

/** A history entry rendered as one line: when, what, and about which step. */
export interface LogEntry {
  at: string | null;
  message: string;
  /** Step slug the entry is about, when it names one. */
  step: string | null;
  /** Event / verdict the entry carries, when there is one. */
  result: string | null;
}

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** One `history[]` entry of the state file as a log line. */
export const toLogEntry = (entry: HistoryEntry): LogEntry => {
  const details = entry.details ?? {};
  return {
    at: entry.timestamp ?? null,
    message: entry.message ?? entry.type ?? '',
    step: asString(details.step) ?? asString(details.fromStep) ?? null,
    result: asString(details.event) ?? asString(details.verdict) ?? null,
  };
};

/**
 * Why a step is SKIPPED. The runner writes the reason onto the step itself, so there is
 * nothing to infer.
 */
export const skipReason =
  (state: RunState | null) =>
  (slug: string): string | null => {
    const step: StepState | undefined = state?.steps[slug];
    return step?.skipReason ?? null;
  };
