import { getIncomers, getOutgoers, type Edge, type Node } from '@xyflow/react';
import type { EdgeData } from './graph.types';

export const withClass = (cls: string | undefined, extra: string): string =>
  [cls, extra].filter(Boolean).join(' ');

export interface FocusedGraph<N extends Node, E extends Edge> {
  nodes: N[];
  edges: E[];
}

/** Where the focus comes from: the card under the pointer, and the pinned (selected) card. */
export interface FocusSources {
  hoveredId: string | null;
  pinnedId: string | null;
}

/** Hover wins while it lasts; the pinned card holds the focus otherwise. */
export const focusIdOf = (sources: FocusSources): string | null =>
  sources.hoveredId ?? sources.pinnedId;

/**
 * The focus overlay the Runs screen draws: the focused card and its direct neighbours (over
 * every edge kind, terminals included) stay, every other card steps back (`dimmed`); only
 * the edges touching the focused card stay, the rest are dimmed too. Quiet edges (untaken
 * loops, escapes, jumps) are `hushed` — thin, faded, no label — unless they touch the focused
 * card or `showAllRoutes` asks for every route. A thin overlay over the arrays: untouched
 * nodes and edges keep their object identity (memoised node components skip re-rendering);
 * with nothing focused and nothing quiet, the arrays come back as they are.
 */
export const applyFocus = <N extends Node, E extends Edge>(
  nodes: N[],
  edges: E[],
  sources: FocusSources,
  showAllRoutes: boolean,
): FocusedGraph<N, E> => {
  const focusId: string | null = focusIdOf(sources);
  const focused: N | undefined = focusId
    ? nodes.find((n: N): boolean => n.id === focusId)
    : undefined;
  const kept: ReadonlySet<string> | null = focused
    ? new Set<string>([
        focused.id,
        ...getIncomers(focused, nodes, edges).map((n: N): string => n.id),
        ...getOutgoers(focused, nodes, edges).map((n: N): string => n.id),
      ])
    : null;
  const incident = (e: E): boolean =>
    focused !== undefined && (e.source === focused.id || e.target === focused.id);

  return {
    nodes: kept
      ? nodes.map((n: N): N =>
          kept.has(n.id) ? n : ({ ...n, className: withClass(n.className, 'dimmed') } as N),
        )
      : nodes,
    edges: edges.map((e: E): E => {
      const dim: boolean = kept !== null && !incident(e);
      const hush: boolean =
        !showAllRoutes && (e.data as EdgeData | undefined)?.quiet === true && !incident(e);
      if (!dim && !hush) return e;
      return {
        ...e,
        className: withClass(withClass(e.className, dim ? 'dimmed' : ''), hush ? 'edge-quiet' : ''),
        data: {
          ...(e.data as Record<string, unknown>),
          ...(dim ? { dimmed: true } : {}),
          ...(hush ? { hushed: true } : {}),
        },
      } as E;
    }),
  };
};

/**
 * Hover focus as the Editor draws it: the hovered node and its neighbours stay, everything
 * else steps back (`dimmed` on the node and the edge, `data.dimmed` for the edge's label).
 * Nothing hovered: the arrays come back as they are.
 */
export const dimOutsideFocus = <N extends Node, E extends Edge>(
  nodes: N[],
  edges: E[],
  hoveredId: string | null,
): FocusedGraph<N, E> => {
  if (!hoveredId) return { nodes, edges };
  const hovered: N | undefined = nodes.find((n: N): boolean => n.id === hoveredId);
  if (!hovered) return { nodes, edges };

  const focus = new Set<string>([hoveredId]);
  for (const n of getIncomers(hovered, nodes, edges)) focus.add(n.id);
  for (const n of getOutgoers(hovered, nodes, edges)) focus.add(n.id);

  return dimExcept(
    nodes,
    edges,
    focus,
    (e: E): boolean => focus.has(e.source) && focus.has(e.target),
  );
};

/** Dim every node outside `kept` and every edge `keepEdge` rejects. */
export const dimExcept = <N extends Node, E extends Edge>(
  nodes: N[],
  edges: E[],
  kept: ReadonlySet<string>,
  keepEdge: (edge: E) => boolean,
): FocusedGraph<N, E> => ({
  nodes: nodes.map((n: N): N =>
    kept.has(n.id) ? n : ({ ...n, className: withClass(n.className, 'dimmed') } as N),
  ),
  edges: edges.map((e: E): E =>
    keepEdge(e)
      ? e
      : ({
          ...e,
          className: withClass(e.className, 'dimmed'),
          data: { ...(e.data as Record<string, unknown>), dimmed: true },
        } as E),
  ),
});
