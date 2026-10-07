import path from 'node:path';
import type { LoadedPipeline, StepDefinition } from '../load/index.js';
import {
  END_ID,
  START_ID,
  buildEdges,
  displayDocPath,
  highlightHappyPath,
  rankPipeline,
  stepMax,
  type EdgeData,
  type GraphEdge as StudioEdge,
  type GraphPipeline,
  type PipelineRanks,
} from '../../shared/studio-graph/index.js';
import { substitute } from '../load/load.utils.js';
import type { EdgeKind, EdgeLane, GraphEdge, GraphModel, GraphNode } from './graph.types.js';
import { HUMAN_AGENT, firstLine } from './graph.utils.js';

/** 0 for the first step of its rank in DFS order (the main row), then 1, 2, … down the stack. */
const stackIndexes = (ranks: PipelineRanks): Record<string, number> => {
  const seen: Record<number, number> = {};
  return Object.fromEntries(
    ranks.order.map((slug: string): [string, number] => {
      const rank: number = ranks.rank[slug] ?? 1;
      const index: number = seen[rank] ?? 0;
      seen[rank] = index + 1;
      return [slug, index];
    }),
  );
};

const terminal = (id: string, rank: number): GraphNode => ({
  id,
  kind: id === START_ID ? 'start' : 'end',
  agent: null,
  model: null,
  rank,
  stackIndex: 0,
  max: null,
  inputs: [],
  outputs: [],
  knowledge: [],
  prompt: null,
  unreachable: false,
});

const stepNode =
  (loaded: LoadedPipeline, ranks: PipelineRanks, stacks: Record<string, number>) =>
  (slug: string, step: StepDefinition): GraphNode => {
    const human: boolean = step.agent === HUMAN_AGENT;
    return {
      id: slug,
      kind: human ? 'human' : 'step',
      agent: step.agent,
      model: human ? null : (step.model ?? null),
      rank: ranks.rank[slug] ?? 1,
      stackIndex: stacks[slug] ?? 0,
      max: stepMax(step) ?? null,
      inputs: step.input,
      outputs: step.output,
      knowledge: step.knowledge.map(displayDocPath),
      prompt: substitute(loaded.variables)(firstLine(step.prompt)),
      unreachable: loaded.unreachable.includes(slug),
    };
  };

const kindOf = (data: EdgeData): EdgeKind =>
  data.kind === 'max' ? 'max' : data.loop ? 'loop' : data.jump ? 'jump' : 'forward';

/** The capped event among the edge's results, with its cap — what a `×N` badge prints. */
const capOf = (
  step: StepDefinition | undefined,
  data: EdgeData,
): { event: string | null; max: number | null } => {
  if (data.kind === 'max') {
    const event: string | undefined = data.routes[0]?.event;
    return { event: event ?? null, max: step?.transitions[event ?? '']?.max ?? null };
  }
  const capped: string | undefined = data.results.find(
    (result: string): boolean => step?.transitions[result]?.max !== undefined,
  );
  return capped === undefined
    ? { event: null, max: null }
    : { event: capped, max: step?.transitions[capped]?.max ?? null };
};

const toEdge =
  (loaded: LoadedPipeline) =>
  (edge: StudioEdge): GraphEdge => {
    const data: EdgeData = edge.data as EdgeData;
    const step: StepDefinition | undefined = loaded.definition.steps[edge.source];
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: kindOf(data),
      results: data.kind === 'start' ? [] : data.results,
      ...capOf(step, data),
      lane: data.lane as EdgeLane,
      happy: data.taken,
    };
  };

/** Edges the Studio would draw nothing for: a target that is not a step and not END. */
const droppedEdgeWarnings = (loaded: LoadedPipeline): string[] => {
  const known = (target: string): boolean => target === END_ID || target in loaded.definition.steps;
  return [
    ...loaded.definition.START.filter((slug: string): boolean => !known(slug)).map(
      (slug: string): string => `START → "${slug}": target is not a step, edge not drawn`,
    ),
    ...Object.entries(loaded.definition.steps).flatMap(
      ([slug, step]: [string, StepDefinition]): string[] =>
        Object.entries(step.transitions).flatMap(([event, route]): string[] =>
          [...route.target, ...(route.onMax ?? [])]
            .filter((target: string): boolean => !known(target))
            .map(
              (target: string): string =>
                `${slug} —${event}→ "${target}": target is not a step or END, edge not drawn`,
            ),
        ),
    ),
  ];
};

/**
 * The model: the Studio's rank (longest path over forward edges, back edges are loops), its
 * edge grouping (one edge per source → target, every event on it) and its happy-path lighting,
 * read into renderer-neutral nodes and edges. Deterministic: declaration order throughout.
 */
export const buildGraph = (loaded: LoadedPipeline): GraphModel => {
  const pipeline: GraphPipeline = loaded.definition;
  const ranks: PipelineRanks = rankPipeline(pipeline);
  const stacks: Record<string, number> = stackIndexes(ranks);
  const toStep = stepNode(loaded, ranks, stacks);
  const edges: StudioEdge[] = highlightHappyPath(
    pipeline,
    ranks,
  )(buildEdges(pipeline, ranks, new Set<string>()));
  const { definition } = loaded;
  return {
    id: definition.id,
    name: definition.name ?? null,
    description: definition.description ?? null,
    author: definition.author ?? null,
    file: path.relative(loaded.rootPath, loaded.file).split(path.sep).join('/'),
    stepCount: Object.keys(definition.steps).length,
    nodes: [
      terminal(START_ID, 0),
      ...ranks.order.map((slug: string): GraphNode => toStep(slug, definition.steps[slug]!)),
      terminal(END_ID, ranks.rank[END_ID] ?? 1),
    ],
    edges: edges.map(toEdge(loaded)),
    ranks: ranks.rank,
    variables: { ...loaded.variables },
    outputDir: loaded.outputDir,
    warnings: [...loaded.warnings, ...droppedEdgeWarnings(loaded)],
  };
};
