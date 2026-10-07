import { unique } from '../../shared/utils/fp.utils.js';
import { END } from './pipeline.schema.js';
import type { EdgeDefinition } from './pipeline.types.js';

/** All the graph maths needs of a step — so it reads a definition and a resolved step alike. */
export type GraphSteps = Readonly<Record<string, { transitions: Record<string, EdgeDefinition> }>>;

/** `from->to`. */
export type EdgeKey = string;

export const edgeKey = (from: string, to: string): EdgeKey => `${from}->${to}`;

/** Everywhere an edge can route: its target, plus its onMax escape. */
export const edgeTargets = (edge: EdgeDefinition): string[] => [
  ...edge.target,
  ...(edge.onMax ?? []),
];

/** Steps this step can route to, END excluded, in declaration order. */
export const successors =
  (steps: GraphSteps) =>
  (name: string): string[] =>
    unique(
      Object.values(steps[name]?.transitions ?? {})
        .flatMap(edgeTargets)
        .filter((target: string): boolean => target !== END && target in steps),
    );

/**
 * The edges that close a loop. A depth-first walk from START in declaration order: an edge into
 * a step still on the walk's own stack is the one that makes the cycle. Same walk, same answer,
 * every time — this is what makes "upstream of" a stable notion in a graph with loops.
 */
export const backEdges = (steps: GraphSteps, start: readonly string[]): ReadonlySet<EdgeKey> => {
  const next = successors(steps);

  interface Walk {
    seen: ReadonlySet<string>;
    found: ReadonlySet<EdgeKey>;
  }

  const visit = (walk: Walk, name: string, stack: readonly string[]): Walk =>
    next(name).reduce(
      (acc: Walk, target: string): Walk => {
        if (stack.includes(target) || target === name) {
          return { ...acc, found: new Set([...acc.found, edgeKey(name, target)]) };
        }
        return acc.seen.has(target) ? acc : visit(acc, target, [...stack, name]);
      },
      { ...walk, seen: new Set([...walk.seen, name]) },
    );

  return start
    .filter((name: string): boolean => name in steps)
    .reduce(
      (walk: Walk, name: string): Walk => (walk.seen.has(name) ? walk : visit(walk, name, [])),
      { seen: new Set<string>(), found: new Set<EdgeKey>() },
    ).found;
};

/** Every step reachable from `seeds`, seeds included, following `next`. */
export const reachableFrom =
  (next: (name: string) => string[]) =>
  (seeds: readonly string[]): ReadonlySet<string> => {
    const walk = (seen: ReadonlySet<string>, name: string): ReadonlySet<string> =>
      seen.has(name) ? seen : next(name).reduce(walk, new Set([...seen, name]));
    return seeds.reduce(walk, new Set<string>());
  };

/** Successors with the loop-closing edges taken out: the graph as a DAG. */
export const forwardSuccessors = (
  steps: GraphSteps,
  start: readonly string[],
): ((name: string) => string[]) => {
  const loops: ReadonlySet<EdgeKey> = backEdges(steps, start);
  const next = successors(steps);
  return (name: string): string[] =>
    next(name).filter((target: string): boolean => !loops.has(edgeKey(name, target)));
};

/** True when some edge of some step reachable from START points at END. */
export const reachesEnd = (steps: GraphSteps, start: readonly string[]): boolean =>
  [...reachableFrom(successors(steps))(start)].some((name: string): boolean =>
    Object.values(steps[name]?.transitions ?? {}).some((edge: EdgeDefinition): boolean =>
      edgeTargets(edge).includes(END),
    ),
  );

/**
 * Longest-path depth from START, 1-based, loops excluded — the `order` a step shows on the
 * dashboard. A step a REVISE routes back into keeps the depth it had on the way down.
 */
export const stepOrders = (steps: GraphSteps, start: readonly string[]): Record<string, number> => {
  const next = forwardSuccessors(steps, start);
  const names: string[] = Object.keys(steps);
  const initial: Record<string, number> = Object.fromEntries(
    names.map((name: string): [string, number] => [name, start.includes(name) ? 1 : 0]),
  );

  const relax = (order: Record<string, number>): Record<string, number> =>
    names.reduce(
      (acc: Record<string, number>, name: string): Record<string, number> =>
        (acc[name] ?? 0) === 0
          ? acc
          : next(name).reduce(
              (inner: Record<string, number>, target: string): Record<string, number> =>
                (inner[name] ?? 0) + 1 > (inner[target] ?? 0)
                  ? { ...inner, [target]: (inner[name] ?? 0) + 1 }
                  : inner,
              acc,
            ),
      order,
    );

  // A DAG of n steps settles in at most n rounds.
  return names.reduce(
    (order: Record<string, number>): Record<string, number> => relax(order),
    initial,
  );
};
