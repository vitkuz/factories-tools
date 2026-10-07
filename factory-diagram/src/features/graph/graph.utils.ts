import type { GraphPipeline, GraphRoute, GraphStep } from '../../shared/studio-graph/index.js';
import { END_ID, START_ID } from '../../shared/studio-graph/index.js';
import type { GraphEdge, GraphModel, GraphNode } from './graph.types.js';

export const HUMAN_AGENT = 'human';

/** The first non-empty line of a prompt: what a hover tooltip can show. */
export const firstLine = (lines: readonly string[]): string =>
  lines.find((line: string): boolean => line.trim() !== '')?.trim() ?? '';

/** Model edges of a node, in model order. */
export const edgesFrom =
  (model: GraphModel) =>
  (id: string): GraphEdge[] =>
    model.edges.filter((edge: GraphEdge): boolean => edge.source === id);

export const edgesInto =
  (model: GraphModel) =>
  (id: string): GraphEdge[] =>
    model.edges.filter((edge: GraphEdge): boolean => edge.target === id);

export const stepNodes = (model: GraphModel): GraphNode[] =>
  model.nodes.filter((node: GraphNode): boolean => node.kind === 'step' || node.kind === 'human');

const addTarget = (route: GraphRoute | undefined, target: string): GraphRoute => ({
  ...(route ?? { target: [] }),
  target: [...(route?.target ?? []), target],
});

const addEscape = (route: GraphRoute | undefined, target: string, max: number): GraphRoute => ({
  ...(route ?? { target: [] }),
  max,
  onMax: [...(route?.onMax ?? []), target],
});

/**
 * The structural pipeline the Studio's layout reads, rebuilt from the model: a renderer gets
 * the model only, and the ported `layoutNodes` / `buildEdges` want START + steps + transitions.
 * Lossless for everything the layout looks at (targets, caps, escapes), in model edge order.
 */
export const toGraphPipeline = (model: GraphModel): GraphPipeline => {
  const steps: Record<string, GraphStep> = Object.fromEntries(
    stepNodes(model).map((node: GraphNode): [string, GraphStep] => [
      node.id,
      { agent: node.agent ?? '', transitions: {} },
    ]),
  );
  const withEdge = (acc: Record<string, GraphStep>, edge: GraphEdge): Record<string, GraphStep> => {
    const step: GraphStep | undefined = acc[edge.source];
    if (!step) return acc;
    const transitions: Record<string, GraphRoute> =
      edge.kind === 'max'
        ? {
            ...step.transitions,
            [edge.event ?? 'max']: addEscape(
              step.transitions[edge.event ?? 'max'],
              edge.target,
              edge.max ?? 1,
            ),
          }
        : edge.results.reduce(
            (inner: Record<string, GraphRoute>, result: string): Record<string, GraphRoute> => ({
              ...inner,
              [result]: {
                ...addTarget(inner[result], edge.target),
                ...(edge.event === result && edge.max !== null ? { max: edge.max } : {}),
              },
            }),
            step.transitions,
          );
    return { ...acc, [edge.source]: { ...step, transitions } };
  };
  return {
    START: model.edges
      .filter((edge: GraphEdge): boolean => edge.source === START_ID)
      .map((edge: GraphEdge): string => edge.target),
    steps: model.edges
      .filter((edge: GraphEdge): boolean => edge.source !== START_ID)
      .reduce(withEdge, steps),
  };
};

export const isTerminal = (id: string): boolean => id === START_ID || id === END_ID;
