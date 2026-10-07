import { deriveTraversals, resultKey, type Traversals } from './history';
import { attemptsOf, closedAttempts, lastWaitedMs, workingTimeMs, type Attempt } from './attempts';
import { shortModel, stepCostUSD, stepModel } from './cost';
import type { Cost, Pipeline, PipelineStep, RunState, StepState, StepStatus } from './types';
import {
  assignLanes,
  buildEdges,
  HUMAN_AGENT,
  layoutNodes,
  rankPipeline,
  stackedIds,
  stepMax,
  stepNodeHeight as cardHeight,
  structuralEdgeClass,
  type EdgeData,
  type GraphEdge,
  type GraphNodeOf,
  type PipelineRanks,
  type StepCardData,
  type StepNodeOf,
} from '../../../shared/graph';

export type {
  EdgeData,
  EdgeKind,
  EdgeLane,
  GraphEdge,
  TerminalNodeData,
} from '../../../shared/graph';
export { HANDLE, MONO_COLS, stepMax, stepOnMax } from '../../../shared/graph';

/**
 * Run-aware graph construction: `buildGraph(pipeline, { detailed, cost })(state)` lays the
 * pipeline out with the shared layout and decorates it with what the run did. Colours are
 * never literal here — every status maps to a CSS token name.
 */

/**
 * A step's status as the dashboard shows it. `waiting` and `none` are display-only: the
 * state file has no such step status — `waiting` is the step the run is paused on, and
 * `none` is a step in a pipeline whose run has no state file.
 */
export type StepStatusKey = StepStatus | 'waiting' | 'none';

export interface StatusMeta {
  /** Legend and badge wording — addresses the person ("waiting for you"). */
  label: string;
  /** Wording after a number in a count line ("1 waiting"). */
  count: string;
  /** CSS custom property carrying the status colour. */
  token: string;
}

export const STATUS_META: Record<StepStatusKey, StatusMeta> = {
  PENDING: { label: 'pending', count: 'pending', token: '--st-pending' },
  RUNNING: { label: 'running', count: 'running', token: '--st-running' },
  RETRYING: { label: 'retrying', count: 'retrying', token: '--st-running' },
  COMPLETED: { label: 'completed', count: 'completed', token: '--st-completed' },
  waiting: { label: 'waiting for you', count: 'waiting for you', token: '--st-waiting' },
  FAILED: { label: 'failed', count: 'failed', token: '--st-failed' },
  SKIPPED: { label: 'skipped', count: 'skipped', token: '--st-skipped' },
  none: { label: 'no state', count: 'without state', token: '--st-none' },
};

export const STATUS_ORDER: StepStatusKey[] = [
  'waiting',
  'RUNNING',
  'RETRYING',
  'FAILED',
  'COMPLETED',
  'PENDING',
  'SKIPPED',
  'none',
];

/** The step the run is paused on is waiting for a person, whatever its own status says. */
export const isWaitingStep = (state: RunState | null, slug: string): boolean =>
  state?.status === 'PAUSED' &&
  state.pause?.status === 'AWAITING_INPUT' &&
  state.pause.step === slug;

/**
 * The steps running right now. A graph run keeps them in `frontier`, a wave run in
 * `activeSteps`; a run only ever fills one of the two.
 */
export const activeStepsOf = (state: RunState | null): string[] =>
  state ? (state.frontier.length > 0 ? state.frontier : state.activeSteps) : [];

/** Card mode: `compact` is the default card; `detailed` adds duration and doc lists. */
export type ViewMode = 'compact' | 'detailed';

export interface GraphOptions {
  detailed: boolean;
  /** The run's cost.json when it has one; step cards then print their cost. */
  cost?: Cost | null;
}

export interface StepNodeData extends StepCardData {
  /**
   * Model line of the card: the model the step's agent actually ran on (cost.json), shown
   * short (`fable-5-1`); without cost data the configured one (state → step `model` → "default").
   * Null for human steps.
   */
  model: string | null;
  /** Full id of the model actually used, for the tooltip; null when it is the configured one. */
  actualModel: string | null;
  status: StepStatusKey;
  attempts: number;
  result: string | null;
  prompt: string;
  /** True when `inputs` come from the pipeline definition, not the run. */
  inputsFromPipeline: boolean;
  /** True when `outputs` come from the pipeline definition, not the run. */
  outputsFromPipeline: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  /** Sum of every finished attempt's duration; null when nothing finished with a start time. */
  workingMs: number | null;
  /** Finished attempts counted for `workingMs` (4 for a loop that ran four times). */
  attemptCount: number;
  /** A human gate: how long the last verdict took; null while nobody has answered yet. */
  waitedMs: number | null;
  /** This is `state.currentStep` and the run is running. */
  current: boolean;
  /** The run is waiting for a human verdict on this step. */
  awaitingHuman: boolean;
  hasState: boolean;
  /** From cost.json: what this step's agent runs cost; null without a cost file or agent runs. */
  costUSD: number | null;
}

export type StepNodeType = StepNodeOf<StepNodeData>;
export type GraphNode = GraphNodeOf<StepNodeData>;

export interface GraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const DEFAULT_MODEL = 'default';

export const isHumanStep = (
  pipeline: Pipeline,
  slug: string,
  stepState?: StepState | null,
): boolean => (stepState?.agent ?? pipeline.steps[slug]?.agent) === HUMAN_AGENT;

/** state.model → step.model → "default" (the harness default); `null` for a human step (pure, curried). */
export const resolveModel =
  (pipeline: Pipeline) =>
  (slug: string, stepState?: StepState | null): string | null => {
    if (isHumanStep(pipeline, slug, stepState)) return null;
    const step: PipelineStep | undefined = pipeline.steps[slug];
    return step?.model ?? DEFAULT_MODEL;
  };

/** The definition's knowledge list; omitted and `[]` are the same thing (pure, curried). */
export const resolveKnowledge =
  (pipeline: Pipeline) =>
  (slug: string): string[] =>
    pipeline.steps[slug]?.knowledge ?? [];

/** state.agent → step.agent (pure, curried). */
export const resolveAgent =
  (pipeline: Pipeline) =>
  (slug: string, stepState?: StepState | null): string =>
    stepState?.agent ?? pipeline.steps[slug]?.agent ?? '—';

export interface StepDocs {
  inputs: string[];
  outputs: string[];
  inputsFromPipeline: boolean;
  outputsFromPipeline: boolean;
}

/** Per array: the run's recorded list when it has one, else the definition's (flagged). */
export const resolveDocs =
  (pipeline: Pipeline) =>
  (slug: string, stepState?: StepState | null): StepDocs => {
    const step: PipelineStep | undefined = pipeline.steps[slug];
    // The run records what a step actually wrote (`outputs`); it never records its inputs,
    // so those always come from the definition.
    const outputs: string[] | undefined =
      stepState && stepState.outputs.length > 0 ? stepState.outputs : undefined;
    return {
      inputs: step?.input ?? [],
      outputs: outputs ?? step?.output ?? [],
      inputsFromPipeline: true,
      outputsFromPipeline: outputs === undefined,
    };
  };

/* ------------------------------------------------------------------ nodes */

const stepNodeData =
  (pipeline: Pipeline, state: RunState | null, options: GraphOptions) =>
  (slug: string, stackIndex: number): StepNodeData => {
    const step: PipelineStep = pipeline.steps[slug];
    const st: StepState | undefined = state?.steps?.[slug];
    const docs: StepDocs = resolveDocs(pipeline)(slug, st);
    const human: boolean = isHumanStep(pipeline, slug, st);
    const attempts: Attempt[] = attemptsOf(state)(slug, human);
    const finished: Attempt[] = closedAttempts(attempts);
    const actualModel: string | null = human ? null : stepModel(options.cost)(slug);
    return {
      slug,
      agent: resolveAgent(pipeline)(slug, st),
      model: actualModel ? shortModel(actualModel) : resolveModel(pipeline)(slug, st),
      actualModel,
      human,
      status: isWaitingStep(state, slug) ? 'waiting' : (st?.status ?? 'none'),
      attempts: st?.passes ?? st?.retryCount ?? 0,
      result: st?.event ?? null,
      max: stepMax(step),
      prompt: step.prompt.join('\n'),
      inputs: docs.inputs,
      outputs: docs.outputs,
      inputsFromPipeline: docs.inputsFromPipeline,
      outputsFromPipeline: docs.outputsFromPipeline,
      knowledge: resolveKnowledge(pipeline)(slug),
      startedAt: st?.startedAt ?? null,
      finishedAt: st?.completedAt ?? null,
      workingMs: workingTimeMs(finished, 0),
      attemptCount: finished.length,
      waitedMs: human ? lastWaitedMs(attempts, 0) : null,
      current: state?.status === 'RUNNING' && activeStepsOf(state).includes(slug),
      awaitingHuman: isWaitingStep(state, slug),
      hasState: Boolean(state),
      detailed: options.detailed,
      stackIndex,
      costUSD: stepCostUSD(options.cost)(slug),
    };
  };

/** Card height for a mode: a run without state has no duration line to make room for. */
export const stepNodeHeight = (
  data: Pick<StepNodeData, 'inputs' | 'outputs' | 'knowledge' | 'detailed' | 'hasState'>,
): number => cardHeight(data, data.hasState);

/* ------------------------------------------------------------------ decoration */

/** The edge the comet rides: into the current step, from the source that finished last. */
const liveEdgeId = (
  edges: readonly GraphEdge[],
  traversals: Traversals,
  state: RunState | null,
): string | null => {
  const active: string[] = state?.status === 'RUNNING' ? activeStepsOf(state) : [];
  if (!state || active.length === 0) return null;
  const candidates: GraphEdge[] = edges.filter(
    (e) => active.includes(e.target) && (traversals.edges[e.id] ?? 0) > 0,
  );
  if (candidates.length === 0) return null;
  const finishedAt = (e: GraphEdge): number =>
    Date.parse(state.steps[e.source]?.completedAt ?? '') || 0;
  return candidates.reduce((best: GraphEdge, e: GraphEdge): GraphEdge =>
    finishedAt(e) > finishedAt(best) ? e : best,
  ).id;
};

const statusOf = (state: RunState | null, slug: string): StepStatusKey =>
  isWaitingStep(state, slug) ? 'waiting' : (state?.steps?.[slug]?.status ?? 'none');

export const decorateEdges =
  (traversals: Traversals, state: RunState | null) =>
  (edges: readonly GraphEdge[]): GraphEdge[] => {
    const live: string | null = liveEdgeId(edges, traversals, state);
    return edges.map((e: GraphEdge): GraphEdge => {
      const base: EdgeData = e.data as EdgeData;
      const n: number = traversals.edges[e.id] ?? 0;
      const takenResults: string[] = base.results.filter(
        (r) => (traversals.results[resultKey(e.id, r)] ?? 0) > 0,
      );
      const tone: EdgeData['tone'] =
        takenResults.length > 0 && takenResults.every((r) => r === 'SKIP')
          ? 'skipped'
          : 'completed';
      const touchesSkipped: boolean =
        statusOf(state, e.source) === 'SKIPPED' || statusOf(state, e.target) === 'SKIPPED';
      const data: EdgeData = {
        ...base,
        traversals: n,
        taken: n > 0,
        takenResults,
        tone,
        bypassed: n === 0 && touchesSkipped,
        live: e.id === live,
      };
      const classes: string[] = [
        structuralEdgeClass(data),
        data.results.includes('SKIP') ? 'edge-skip' : '',
        data.taken ? 'edge-taken' : '',
        data.taken && tone === 'skipped' ? 'edge-taken--skipped' : '',
        data.bypassed ? 'edge-bypassed' : '',
        data.live ? 'edge-live' : '',
      ].filter(Boolean);
      return { ...e, data, className: classes.join(' ') };
    });
  };

/** Pure and curried: `buildGraph(pipeline, options)(state)`. */
export const buildGraph =
  (pipeline: Pipeline, options: GraphOptions = { detailed: false }) =>
  (state: RunState | null): GraphResult => {
    const ranks: PipelineRanks = rankPipeline(pipeline);
    const nodes: GraphNode[] = layoutNodes(
      pipeline,
      ranks,
      stepNodeData(pipeline, state, options),
      stepNodeHeight,
    );
    const edges: GraphEdge[] = decorateEdges(
      deriveTraversals(pipeline)(state),
      state,
    )(assignLanes(nodes, ranks)(buildEdges(pipeline, ranks, stackedIds(nodes))));
    return { nodes, edges };
  };

/** Statuses present in a graph, in legend order (for the canvas legend panel). */
export const statusesPresent = (nodes: readonly GraphNode[]): StepStatusKey[] => {
  const present = new Set<StepStatusKey>(
    nodes.flatMap((n: GraphNode): StepStatusKey[] =>
      n.type === 'step' ? [(n.data as StepNodeData).status] : [],
    ),
  );
  return STATUS_ORDER.filter((s) => present.has(s));
};

/** "3 completed, 2 skipped" — step counts for the run pane. */
export const stepStatusCounts = (state: RunState | null): Array<[StepStatusKey, number]> => {
  if (!state) return [];
  const counts: Partial<Record<StepStatusKey, number>> = {};
  for (const [slug, st] of Object.entries(state.steps)) {
    const key: StepStatusKey = isWaitingStep(state, slug) ? 'waiting' : st.status;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return STATUS_ORDER.flatMap((s): Array<[StepStatusKey, number]> =>
    counts[s] ? [[s, counts[s] as number]] : [],
  );
};
