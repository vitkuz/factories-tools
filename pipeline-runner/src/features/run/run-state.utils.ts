import { flow, unique } from '../../shared/utils/fp.utils.js';
import { END, reachableFrom, stepOrders, successors } from '../pipeline/index.js';
import type { ResolvedPipeline, ResolvedStep } from '../pipeline/index.js';
import type {
  AgentUsage,
  Entry,
  HistoryEvent,
  RunState,
  StepOutcome,
  StepRecord,
} from './run.types.js';

/** A transition: the state before, the state after. Nothing is ever mutated. */
export type Transition = (state: RunState) => RunState;

type EventOutcome = Extract<StepOutcome, { kind: 'event' }>;

const SCHEMA_REF = 'factories/state.schema.json';

// --- small lenses ----------------------------------------------------------------------------

const touch =
  (at: string): Transition =>
  (state: RunState): RunState => ({ ...state, updatedAt: at });

const updateStep =
  (name: string, change: (record: StepRecord) => StepRecord): Transition =>
  (state: RunState): RunState => {
    const record: StepRecord | undefined = state.steps[name];
    return record === undefined
      ? state
      : { ...state, steps: { ...state.steps, [name]: change(record) } };
  };

const updateCaptured =
  (
    change: (captured: RunState['context']['captured']) => RunState['context']['captured'],
  ): Transition =>
  (state: RunState): RunState => ({
    ...state,
    context: { ...state.context, captured: change(state.context.captured) },
  });

export const appendHistory =
  (event: HistoryEvent): Transition =>
  (state: RunState): RunState => ({ ...state, history: [...state.history, event] });

/** Field by field; a field neither side reported stays absent rather than becoming 0. */
export const addUsage = (left: AgentUsage, right: AgentUsage | undefined): AgentUsage =>
  Object.fromEntries(
    [...new Set([...Object.keys(left), ...Object.keys(right ?? {})])].map(
      (key: string): [string, number] => [
        key,
        (left[key as keyof AgentUsage] ?? 0) + (right?.[key as keyof AgentUsage] ?? 0),
      ],
    ),
  );

const without = (names: readonly string[], name: string): string[] =>
  names.filter((other: string): boolean => other !== name);

const bracket = (names: readonly string[]): string => `[${names.join(' ')}]`;

// --- opening ---------------------------------------------------------------------------------

export const openRun = (pipeline: ResolvedPipeline, runId: string, at: string): RunState => {
  const orders: Record<string, number> = stepOrders(pipeline.steps, pipeline.start);
  const state: RunState = {
    $schema: SCHEMA_REF,
    runId,
    pipelineName: pipeline.id,
    pipelineFile: pipeline.file,
    status: 'IDLE',
    createdAt: at,
    updatedAt: at,
    currentWave: 1,
    activeSteps: [],
    context: {
      constants: Object.fromEntries(
        Object.entries(pipeline.variables).filter(
          ([name]: [string, string]): boolean => !(name in pipeline.params),
        ),
      ),
      params: pipeline.params,
      captured: {
        runner: 'pipeline-runner',
        slug: pipeline.variables['slug'] ?? '',
        date: pipeline.variables['date'] ?? '',
        outputDir: pipeline.outputDir,
        requeued: [],
        enteredBy: {},
        costUsd: 0,
        usage: {},
      },
    },
    steps: Object.fromEntries(
      Object.values(pipeline.steps).map((step: ResolvedStep): [string, StepRecord] => [
        step.name,
        {
          order: orders[step.name] ?? 0,
          kind: 'agent',
          agent: step.agent,
          status: 'PENDING',
          retryCount: 0,
        },
      ]),
    ),
    history: [],
    mode: 'graph',
    frontier: [...pipeline.start],
    edges: {},
    vars: {},
  };
  return appendHistory({
    timestamp: at,
    type: 'PIPELINE_INIT',
    message: `Pipeline '${pipeline.id}' initialized with runId '${runId}'.`,
    details: { runId, start: pipeline.start, runner: 'pipeline-runner' },
  })(state);
};

/** Which harness runs the steps — kept in the record so `resume` carries on with the same one. */
export const recordHarness = (harness: string | undefined): Transition =>
  harness === undefined ? flow() : updateCaptured((captured) => ({ ...captured, harness }));

export const markRunStarted = (at: string): Transition =>
  flow(
    (state: RunState): RunState => ({ ...state, status: 'RUNNING' }),
    appendHistory({ timestamp: at, type: 'WAVE_START', message: 'Pipeline started at wave 1.' }),
    touch(at),
  );

// --- a step's life -----------------------------------------------------------------------------

export const startStep =
  (at: string) =>
  (name: string): Transition =>
  (state: RunState): RunState => {
    const passes = (state.steps[name]?.passes ?? 0) + 1;
    return flow(
      updateStep(
        name,
        ({ completedAt: _completedAt, error: _error, ...record }: StepRecord): StepRecord => ({
          ...record,
          status: 'RUNNING',
          startedAt: at,
          passes,
        }),
      ),
      (next: RunState): RunState => ({
        ...next,
        activeSteps: unique([...next.activeSteps, name]),
        currentWave: next.steps[name]?.order || next.currentWave,
      }),
      appendHistory({
        timestamp: at,
        type: 'STEP_START',
        step: name,
        message: `Step '${name}' started.`,
        ...(passes > 1 ? { details: { pass: passes } } : {}),
      }),
      touch(at),
    )(state);
  };

/**
 * Put the targets on the frontier. A target that is running right now cannot start again yet,
 * so it is remembered and goes again the moment it finishes.
 */
const activate =
  (entry: Entry, targets: readonly string[]): Transition =>
  (state: RunState): RunState => {
    const steps: string[] = targets.filter((target: string): boolean => target !== END);
    const busy: string[] = steps.filter((target: string): boolean =>
      state.activeSteps.includes(target),
    );
    const free: string[] = steps.filter((target: string): boolean => !busy.includes(target));
    return flow(
      (next: RunState): RunState => ({ ...next, frontier: unique([...next.frontier, ...free]) }),
      ...free.map((target: string): Transition =>
        updateStep(target, (record: StepRecord): StepRecord => ({ ...record, status: 'PENDING' })),
      ),
      updateCaptured((captured) => ({
        ...captured,
        requeued: unique([...captured.requeued, ...busy]),
        enteredBy: {
          ...captured.enteredBy,
          ...Object.fromEntries(steps.map((target: string): [string, Entry] => [target, entry])),
        },
      })),
    )(state);
  };

/** A finished step leaves the frontier — unless someone routed into it while it ran. */
const release =
  (name: string): Transition =>
  (state: RunState): RunState => {
    const again: boolean = state.context.captured.requeued.includes(name);
    return flow(
      (next: RunState): RunState => ({
        ...next,
        activeSteps: without(next.activeSteps, name),
        frontier: again ? next.frontier : without(next.frontier, name),
      }),
      updateCaptured((captured) => ({ ...captured, requeued: without(captured.requeued, name) })),
      again
        ? updateStep(name, (record: StepRecord): StepRecord => ({ ...record, status: 'PENDING' }))
        : flow(),
    )(state);
  };

export interface Routing {
  edge: string;
  targets: string[];
  capped?: { max: number; onMax: string[] };
}

/** The step returned an event and the graph accepted it: record it, count the edge, move the frontier. */
export const completeStep =
  (at: string) =>
  (outcome: EventOutcome, routing: Routing): Transition => {
    const { step, event }: EventOutcome = outcome;
    const details: Record<string, unknown> = {
      event,
      ...(outcome.note === '' ? {} : { note: outcome.note }),
      ...(outcome.outputs.length === 0 ? {} : { outputs: outcome.outputs }),
      ...(Object.keys(outcome.reported).length === 0 ? {} : { reported: outcome.reported }),
      targets: routing.targets,
      // Per pass, so a step that looped can still be priced: the record below keeps only the last.
      ...(outcome.sessionId === undefined ? {} : { sessionId: outcome.sessionId }),
      ...(outcome.costUsd === undefined ? {} : { costUsd: outcome.costUsd }),
      ...(outcome.usage === undefined ? {} : { usage: outcome.usage }),
      ...(outcome.durationMs === undefined ? {} : { durationMs: outcome.durationMs }),
    };
    const arrow = `"${event}" -> ${bracket(routing.targets)}`;
    return flow(
      updateStep(
        step,
        ({
          outputs: _o,
          note: _n,
          reported: _r,
          error: _e,
          ...record
        }: StepRecord): StepRecord => ({
          ...record,
          status: 'COMPLETED',
          completedAt: at,
          event,
          ...(outcome.outputs.length === 0 ? {} : { outputs: outcome.outputs }),
          ...(outcome.note === '' ? {} : { note: outcome.note }),
          ...(Object.keys(outcome.reported).length === 0 ? {} : { reported: outcome.reported }),
          ...(outcome.sessionId === undefined ? {} : { sessionId: outcome.sessionId }),
          ...(outcome.transcriptPath === undefined
            ? {}
            : { transcriptPath: outcome.transcriptPath }),
        }),
      ),
      (state: RunState): RunState => ({
        ...state,
        edges: { ...state.edges, [routing.edge]: (state.edges[routing.edge] ?? 0) + 1 },
        vars: { ...state.vars, ...outcome.reported },
      }),
      updateCaptured((captured) => ({
        ...captured,
        costUsd: captured.costUsd + (outcome.costUsd ?? 0),
        usage: addUsage(captured.usage, outcome.usage),
      })),
      appendHistory({
        timestamp: at,
        type: outcome.human ? 'HUMAN_ANSWER' : 'STEP_EVENT',
        step,
        message: outcome.human
          ? `Human answered ${arrow} at "${step}".`
          : `Step "${step}" returned ${arrow}.`,
        details,
      }),
      routing.capped === undefined
        ? flow()
        : appendHistory({
            timestamp: at,
            type: 'EDGE_CAPPED',
            step,
            message:
              routing.capped.onMax.length > 0
                ? `Edge "${routing.edge}" spent its cap of ${routing.capped.max}; took onMax to ${bracket(routing.capped.onMax)} instead.`
                : `Edge "${routing.edge}" spent its cap of ${routing.capped.max} and declares no onMax.`,
            details: { ...routing.capped },
          }),
      release(step),
      activate({ from: step, event }, routing.targets),
      touch(at),
    );
  };

export const failStep =
  (at: string) =>
  (name: string, error: string): Transition =>
    flow(
      updateStep(name, (record: StepRecord): StepRecord => ({
        ...record,
        status: 'FAILED',
        completedAt: at,
        error,
      })),
      (state: RunState): RunState => ({ ...state, activeSteps: without(state.activeSteps, name) }),
      appendHistory({
        timestamp: at,
        type: 'STEP_FAIL',
        step: name,
        message: `Step '${name}' failed permanently: ${error}`,
        details: { error },
      }),
      touch(at),
    );

/**
 * A branch nobody takes is closed, not left waiting: every pending step that nothing on the
 * frontier can still reach — following target and onMax alike — is skipped, with the reason.
 */
export const skipUnreachable =
  (at: string, pipeline: ResolvedPipeline) =>
  (decidedBy: string, event: string): Transition =>
  (state: RunState): RunState => {
    const reachable: ReadonlySet<string> = reachableFrom(successors(pipeline.steps))(
      state.frontier,
    );
    const reason = `${decidedBy} returned ${event} and nothing routes here any more`;
    const stranded: string[] = Object.keys(state.steps)
      .sort()
      .filter(
        (name: string): boolean => state.steps[name]?.status === 'PENDING' && !reachable.has(name),
      );
    return flow(
      ...stranded.flatMap((name: string): Transition[] => [
        updateStep(name, (record: StepRecord): StepRecord => ({
          ...record,
          status: 'SKIPPED',
          completedAt: at,
          skipReason: reason,
        })),
        appendHistory({
          timestamp: at,
          type: 'STEP_SKIP',
          step: name,
          message: `Step "${name}" skipped: ${reason}.`,
          details: { reason, unreachable: true },
        }),
      ]),
    )(state);
  };

// --- closing -----------------------------------------------------------------------------------

export const completeRun = (at: string): Transition =>
  flow(
    (state: RunState): RunState => ({ ...state, status: 'COMPLETED' }),
    appendHistory({
      timestamp: at,
      type: 'PIPELINE_COMPLETE',
      message: 'Every branch reached END and no step is running.',
    }),
    touch(at),
  );

export const failRun =
  (at: string) =>
  (reason: string): Transition =>
    flow(
      (state: RunState): RunState => ({ ...state, status: 'FAILED' }),
      appendHistory({
        timestamp: at,
        type: 'PIPELINE_FAIL',
        message: `Pipeline failed: ${reason}`,
        details: { reason },
      }),
      touch(at),
    );

/**
 * Pick a stopped run back up: whatever was running or had failed when it stopped goes back on
 * the frontier as pending. Finished steps, edge counts and reported values are kept as they are.
 */
export const resumeRun =
  (at: string): Transition =>
  (state: RunState): RunState => {
    const retry: string[] = Object.keys(state.steps).filter((name: string): boolean =>
      ['RUNNING', 'FAILED', 'RETRYING'].includes(state.steps[name]?.status ?? ''),
    );
    return flow(
      ...retry.map((name: string): Transition =>
        updateStep(name, ({ error: _error, ...record }: StepRecord): StepRecord => ({
          ...record,
          status: 'PENDING',
          retryCount: (record.retryCount ?? 0) + 1,
        })),
      ),
      (next: RunState): RunState => ({
        ...next,
        status: 'RUNNING',
        activeSteps: [],
        frontier: unique([...next.frontier, ...retry, ...next.context.captured.requeued]),
      }),
      updateCaptured((captured) => ({ ...captured, requeued: [] })),
      appendHistory({
        timestamp: at,
        type: 'PIPELINE_RESUME',
        message: `Pipeline resumed; ${retry.length > 0 ? `retrying ${bracket(retry)}` : 'nothing to retry'}.`,
        details: { retry },
      }),
      touch(at),
    )(state);
  };
