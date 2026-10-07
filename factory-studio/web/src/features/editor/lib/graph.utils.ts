import type { Edge, Node } from '@xyflow/react';
import type {
  FlowEdge,
  FlowNode,
  Issue,
  Pipeline,
  PipelineStep,
  Selection,
  StepNodeData,
} from './pipeline.types';
import {
  buildDefinitionGraph,
  dimExcept,
  HUMAN_AGENT,
  stepMax,
  stepNodeHeight,
  type EdgeData,
  type EdgeRouteRef,
  type FocusedGraph,
} from '../../../shared/graph';

/**
 * The editor's graph: the shared definition layout (the one the Runs screen draws), with
 * the editor's selection and issue counts written onto it. No run data: the happy path
 * is lit and everything else stays grey.
 */

export interface EditorGraphOptions {
  detailed: boolean;
  issues: Issue[];
  selection: Selection | null;
}

export interface EditorGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

const DEFAULT_MODEL = 'default';

/** The step's model line: the file's `model` key (an extra the editor does not model), else the harness default. */
const modelOf = (step: PipelineStep): string =>
  typeof step.extras?.model === 'string' ? step.extras.model : DEFAULT_MODEL;

const issuesFor = (issues: Issue[], subject: string): number =>
  issues.filter((issue: Issue): boolean => issue.subject === subject).length;

const stepData =
  (pipeline: Pipeline, options: EditorGraphOptions) =>
  (slug: string, stackIndex: number): StepNodeData => {
    const step: PipelineStep = pipeline.steps[slug];
    const human: boolean = step.agent === HUMAN_AGENT;
    return {
      slug,
      agent: step.agent,
      model: human ? null : modelOf(step),
      human,
      max: stepMax(step),
      inputs: step.input ?? [],
      outputs: step.output ?? [],
      knowledge: step.knowledge ?? [],
      detailed: options.detailed,
      stackIndex,
      issueCount: issuesFor(options.issues, slug),
    };
  };

/** True when this edge draws the event the inspector is editing. */
const edgeSelected = (edge: FlowEdge, selection: Selection | null): boolean =>
  selection?.kind === 'edge' &&
  edge.source === selection.source &&
  (edge.data?.routes ?? []).some((r: EdgeRouteRef): boolean => r.event === selection.event);

export const buildEditorGraph = (pipeline: Pipeline, options: EditorGraphOptions): EditorGraph => {
  const { nodes, edges }: EditorGraph = buildDefinitionGraph(
    pipeline,
    stepData(pipeline, options),
    (data: StepNodeData): number => stepNodeHeight(data, false),
  );
  const { selection }: EditorGraphOptions = options;
  return {
    nodes: nodes.map((node: FlowNode): FlowNode => {
      const selected: boolean = selection?.kind === 'step' && selection.name === node.id;
      return selected === Boolean(node.selected) ? node : ({ ...node, selected } as FlowNode);
    }),
    edges: edges.map((edge: FlowEdge): FlowEdge => {
      const selected: boolean = edgeSelected(edge, selection);
      return selected === Boolean(edge.selected) ? edge : { ...edge, selected };
    }),
  };
};

/** The happy-path switch: every retry, escape and alternative route steps back, with the steps only they reach. */
export const dimOffHappyPath = <N extends Node, E extends Edge>(
  nodes: N[],
  edges: E[],
): FocusedGraph<N, E> => {
  const taken = (edge: E): boolean => (edge.data as EdgeData | undefined)?.taken === true;
  const kept = new Set<string>(
    edges.filter(taken).flatMap((edge: E): string[] => [edge.source, edge.target]),
  );
  return dimExcept(nodes, edges, kept, taken);
};

/** A signature of the laid-out structure: when it changes, the view fits the graph again. */
export const layoutKey = (nodes: readonly Node[]): string =>
  nodes
    .map((n: Node): string => `${n.id}@${n.position.x},${n.position.y},${n.height ?? 0}`)
    .join('|');
