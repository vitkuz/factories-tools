import { getIncomers, getOutgoers, type Edge, type Node } from '@xyflow/react';

export const withClass = (cls: string | undefined, extra: string): string =>
  [cls, extra].filter(Boolean).join(' ');

export interface FocusedGraph<N extends Node, E extends Edge> {
  nodes: N[];
  edges: E[];
}

/**
 * Hover focus: the hovered node and its neighbours stay, everything else steps back
 * (`dimmed` on the node and the edge, `data.dimmed` for the edge's label). A thin overlay
 * over the arrays, so untouched nodes and edges keep their object identity (memoised
 * node components skip re-rendering). Nothing hovered: the arrays come back as they are.
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
