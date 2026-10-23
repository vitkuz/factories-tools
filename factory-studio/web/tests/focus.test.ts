import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { applyFocus, focusIdOf, type FocusedGraph } from '../src/shared/graph';

type N = Node<{ label: string }>;
type E = Edge<{ quiet: boolean; hushed?: boolean; dimmed?: boolean; hidden?: boolean }>;

const node = (id: string): N => ({ id, position: { x: 0, y: 0 }, data: { label: id } });
const edge = (source: string, target: string, quiet: boolean = false): E => ({
  id: `e:${source}->${target}`,
  source,
  target,
  data: { quiet },
});

// a → b → c → d, with a quiet retry c → a and a quiet escape b → d.
const nodes: N[] = ['a', 'b', 'c', 'd'].map(node);
const edges: E[] = [
  edge('a', 'b'),
  edge('b', 'c'),
  edge('c', 'd'),
  edge('c', 'a', true),
  edge('b', 'd', true),
];

const classes = (g: FocusedGraph<N, E>): Record<string, string> =>
  Object.fromEntries(
    [...g.nodes, ...g.edges].map((x: N | E): [string, string] => [x.id, x.className ?? '']),
  );

describe('focusIdOf', () => {
  it('hover wins while it lasts, the pin holds otherwise', () => {
    expect(focusIdOf({ hoveredId: 'a', pinnedId: 'b' })).toBe('a');
    expect(focusIdOf({ hoveredId: null, pinnedId: 'b' })).toBe('b');
    expect(focusIdOf({ hoveredId: null, pinnedId: null })).toBeNull();
  });
});

describe('applyFocus', () => {
  it('with nothing focused, only the quiet edges change and everything else keeps its identity', () => {
    const g: FocusedGraph<N, E> = applyFocus(
      nodes,
      edges,
      { hoveredId: null, pinnedId: null },
      false,
    );
    expect(g.nodes).toEqual(nodes);
    g.nodes.forEach((n: N, i: number): void => expect(n).toBe(nodes[i]));
    expect(g.edges[0]).toBe(edges[0]);
    expect(classes(g)['e:c->a']).toBe('edge-quiet');
    expect(g.edges[3].data?.hushed).toBe(true);
    expect(g.edges[0].data?.hushed).toBeUndefined();
  });

  it('`All routes` leaves the quiet edges alone', () => {
    const g: FocusedGraph<N, E> = applyFocus(
      nodes,
      edges,
      { hoveredId: null, pinnedId: null },
      true,
    );
    expect(g.nodes).toBe(nodes);
    g.edges.forEach((e: E, i: number): void => expect(e).toBe(edges[i]));
  });

  it('a pinned card keeps its direct neighbours and its own edges; the rest steps back', () => {
    const g: FocusedGraph<N, E> = applyFocus(
      nodes,
      edges,
      { hoveredId: null, pinnedId: 'b' },
      false,
    );
    const c: Record<string, string> = classes(g);
    expect(c.a).toBe('');
    expect(c.b).toBe('');
    expect(c.c).toBe('');
    expect(c.d).toBe(''); // the escape b → d makes d a neighbour too
    expect(c['e:a->b']).toBe('');
    expect(c['e:b->c']).toBe('');
    expect(c['e:c->d']).toBe('edge-hidden');
    // the quiet retry c → a touches two neighbours but not b: hidden and still quiet
    expect(c['e:c->a']).toBe('edge-hidden edge-quiet');
    // the quiet escape out of b is revealed
    expect(c['e:b->d']).toBe('');
    expect(g.edges[4].data?.hushed).toBeUndefined();
    expect(g.nodes[1]).toBe(nodes[1]);
  });

  it('a card with no neighbours in the focus dims', () => {
    const g: FocusedGraph<N, E> = applyFocus(
      nodes,
      edges,
      { hoveredId: null, pinnedId: 'd' },
      false,
    );
    const c: Record<string, string> = classes(g);
    expect(c.a).toBe('dimmed');
    expect(c.b).toBe('');
    expect(c.c).toBe('');
    expect(c.d).toBe('');
    expect(g.edges.find((e: E): boolean => e.id === 'e:a->b')?.data?.hidden).toBe(true);
  });

  it('hover overrides the pin and leaves the pinned card dimmed when it is no neighbour', () => {
    const g: FocusedGraph<N, E> = applyFocus(
      nodes,
      edges,
      { hoveredId: 'd', pinnedId: 'a' },
      false,
    );
    const c: Record<string, string> = classes(g);
    expect(c.a).toBe('dimmed');
    expect(c.d).toBe('');
  });

  it('an unknown focus id focuses nothing', () => {
    const g: FocusedGraph<N, E> = applyFocus(
      nodes,
      edges,
      { hoveredId: null, pinnedId: 'zz' },
      true,
    );
    expect(g.nodes).toBe(nodes);
  });
});
