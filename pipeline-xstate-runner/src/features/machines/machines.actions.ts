// Learned from factories-tools/pipeline-state/src/features/commands/*.command.ts (the transitions a run
// records) and factories-tools/pipeline-runner/src/features/run/run-state.utils.ts. Every function here is a
// pure reducer: the context before in, the context after out. The machines wrap them in `assign`.
import path from 'node:path';
import { runIdFor } from '../../clients/ids/ids.utils.js';
import type { AgentUsage } from '../../clients/harness/harness.types.js';
import { flow } from '../../shared/utils/fp.utils.js';
import { repoRelative } from '../../shared/utils/path.utils.js';
import { layersOf } from '../pipeline/pipeline.utils.js';
import { END } from '../pipeline/pipeline.utils.js';
import { resolvePipeline } from '../pipeline/services/resolve-pipeline.service.js';
import type { ResolvedPipeline, ResolvedStep, Scalar } from '../pipeline/pipeline.types.js';
import type { StepMaterials } from '../prompt/prompt.types.js';
import { buildRetryPrompt, buildStepPrompt } from '../prompt/services/build-step-prompt.service.js';
import { skipStranded as skipStrandedSteps } from '../routing/skip-stranded.utils.js';
import type { EdgeDecision, RouteResult } from '../routing/routing.types.js';
import type { HistoryDraft, State, StepRecord, Transition } from '../state/state.types.js';
import {
  addActive,
  addToFrontier,
  recordAt,
  removeActive,
  removeFromFrontier,
  setFrontier,
  setStatus,
  skipStep,
  stepNamesWith,
  updateCaptured,
  updateStep,
  withoutKeys,
} from '../state/state.utils.js';
import type {
  HookReport,
  HooksOutput,
  HumanContext,
  RunContext,
  RunStepOutput,
  StepContext,
  StepDoneEvent,
  StepParkedEvent,
  ValidateOutput,
} from './machines.types.js';
import { INTERRUPTED, RUNNER_NAME } from './machines.types.js';
import { requirePipeline, requireState, routeOf } from './machines.utils.js';

const withState =
  (change: Transition) =>
  (context: RunContext): RunContext => ({ ...context, state: change(requireState(context)) });

// --- opening ----------------------------------------------------------------------------------

export const keepValidation = (context: RunContext, output: ValidateOutput): RunContext => ({
  ...context,
  validation: output.report,
  openedAt: output.at,
  ...(output.pipeline === undefined ? {} : { document: output.pipeline }),
});

/** The pipeline for this run: params, variables and paths filled in. A misfit param is the error. */
export const resolveRunPipeline = (context: RunContext): RunContext => {
  const { input, document }: RunContext = context;
  if (document === undefined) return { ...context, error: 'the pipeline was not loaded' };
  const resolved = resolvePipeline({
    anchors: {
      rootPath: input.rootPath,
      skillPath: path.join(input.rootPath, '.claude', 'skills', document.id),
      homePath: input.homePath,
    },
    date: context.openedAt.slice(0, 10),
    suppliedParams: input.params,
  })(input.pipelineFile, document);
  return resolved.ok
    ? { ...context, pipeline: resolved.value }
    : { ...context, error: `${resolved.refusal.guard}: ${resolved.refusal.message}` };
};

/** A fresh record per step: PENDING, its breadth-first layer from START. */
const freshSteps = (pipeline: ResolvedPipeline): Record<string, StepRecord> => {
  const layers: Record<string, number> = layersOf(pipeline, pipeline.start);
  return Object.fromEntries(
    Object.entries(pipeline.steps).map(
      ([name, step]: [string, ResolvedStep]): [string, StepRecord] => [
        name,
        {
          order: layers[name] ?? 0,
          kind: 'agent',
          agent: step.agent,
          status: 'PENDING',
          retryCount: 0,
        },
      ],
    ),
  );
};

/** A new run, IDLE, as the recorder's `open` writes it, plus what this runner remembers in `captured`. */
export const openRun = (context: RunContext): RunContext => {
  const pipeline: ResolvedPipeline = requirePipeline(context);
  const { input }: RunContext = context;
  const createdAt: string = context.openedAt;
  const runId: string = runIdFor(createdAt, input.runHex);
  const opened: State = {
    $schema: input.schemaRef,
    runId,
    pipelineName: pipeline.id,
    pipelineFile: repoRelative(input.rootPath)(input.pipelineFile),
    status: 'IDLE',
    createdAt,
    updatedAt: createdAt,
    currentWave: 1,
    activeSteps: [],
    context: {
      constants: Object.fromEntries(
        Object.entries(pipeline.constants).map(
          ([name, value]: [string, Scalar]): [string, string] => [name, String(value)],
        ),
      ),
      params: pipeline.params,
      captured: { runner: RUNNER_NAME, harness: input.options.harness, costUsd: 0, usage: {} },
    },
    steps: freshSteps(pipeline),
    history: [],
    mode: 'graph',
    edges: {},
  };
  return {
    ...context,
    state: recordAt(createdAt)({
      type: 'PIPELINE_INIT',
      message: `Pipeline '${pipeline.id}' initialized with runId '${runId}'.`,
      details: {
        fromStep: '',
        runId,
        sessionId: input.options.sessionId,
        sessionSource: '',
        start: pipeline.start,
        transcriptPath: '',
      },
    })(opened),
  };
};

export const keepHooks = (context: RunContext, output: HooksOutput): RunContext => ({
  ...context,
  hooks: [...context.hooks, ...output.reports],
});

export const failRunOnHook = (context: RunContext, output: HooksOutput): RunContext => {
  const failed: HookReport | undefined = output.reports.find((hook) => hook.exitCode !== 0);
  const reason = `hooks.before failed: ${failed?.command ?? ''} exited ${failed?.exitCode ?? 1}`;
  return withState(failRunWith(output.at, reason))(context);
};

/** RUNNING; the START steps are routed to (the frontier). */
export const startRun = (context: RunContext, at: string): RunContext =>
  withState(
    flow<State>(
      setStatus('RUNNING'),
      setFrontier(requirePipeline(context).start),
      recordAt(at)({
        type: 'WAVE_START',
        message: `Pipeline started at wave ${requireState(context).currentWave}.`,
      }),
    ),
  )(context);

// --- a step's life ----------------------------------------------------------------------------

/** What a pass leaves behind; a new pass starts without it. */
const PASS_FIELDS: readonly (keyof StepRecord)[] = [
  'completedAt',
  'outputs',
  'event',
  'reported',
  'note',
  'error',
  'skipReason',
];

/** One more pass of a step: RUNNING, off the frontier, on the active list. */
const startStep =
  (at: string) =>
  (name: string): Transition =>
  (state: State): State => {
    const record: StepRecord | undefined = state.steps[name];
    const pass: number = (record?.passes ?? 0) + 1;
    return flow<State>(
      updateStep(name, (step: StepRecord): StepRecord => ({
        ...withoutKeys(PASS_FIELDS)(step),
        status: 'RUNNING',
        startedAt: at,
        passes: pass,
      })),
      addActive(name),
      removeFromFrontier(name),
      (current: State): State => ({
        ...current,
        currentWave: Math.max(current.currentWave, record?.order || 1),
      }),
      recordAt(at)({
        type: 'STEP_START',
        step: name,
        message: `Step '${name}' started.`,
        ...(pass > 1 ? { details: { pass } } : {}),
      }),
    )(state);
  };

/** Every ready step starts now, in name order. */
export const startSteps = (context: RunContext, names: readonly string[], at: string): RunContext =>
  withState(flow<State>(...names.map(startStep(at))))(context);

export const haltRun = (context: RunContext, reason: string): RunContext => ({
  ...context,
  halt: context.halt ?? reason,
});

/** A spent edge takes onMax and says so; any other edge is counted. */
const takeEdge =
  (at: string, name: string) =>
  (decision: EdgeDecision): Transition =>
    decision.capped
      ? recordAt(at)({
          type: 'EDGE_CAPPED',
          step: name,
          message: `Edge "${decision.key}" reached its max of ${decision.max}; taking onMax -> [${decision.targets.join(', ')}].`,
          details: { edge: decision.key, max: decision.max, targets: decision.targets },
        })
      : (state: State): State => ({
          ...state,
          edges: { ...(state.edges ?? {}), [decision.key]: (state.edges?.[decision.key] ?? 0) + 1 },
        });

/** A target that was skipped earlier can run after all: back to PENDING. */
const reopenSkipped =
  (targets: readonly string[]): Transition =>
  (state: State): State =>
    flow<State>(
      ...targets
        .filter((target: string): boolean => state.steps[target]?.status === 'SKIPPED')
        .map((target: string): Transition =>
          updateStep(target, (step: StepRecord): StepRecord => ({
            ...withoutKeys(['completedAt', 'skipReason'])(step),
            status: 'PENDING',
          })),
        ),
    )(state);

/** Field by field; a field neither side reported stays absent rather than becoming 0. */
const addUsage = (left: AgentUsage, right: AgentUsage | undefined): AgentUsage =>
  Object.fromEntries(
    [...new Set([...Object.keys(left), ...Object.keys(right ?? {})])].map(
      (key: string): [string, number] => [
        key,
        (left[key as keyof AgentUsage] ?? 0) + (right?.[key as keyof AgentUsage] ?? 0),
      ],
    ),
  );

/** The pass's price goes on the run's running total in `captured`, where ai-usage reads it. */
const addCost =
  (outcome: StepDoneEvent): Transition =>
  (state: State): State =>
    outcome.costUsd === undefined && outcome.usage === undefined
      ? state
      : updateCaptured((captured) => ({
          ...captured,
          costUsd: Number(captured['costUsd'] ?? 0) + (outcome.costUsd ?? 0),
          usage: addUsage((captured['usage'] as AgentUsage | undefined) ?? {}, outcome.usage),
        }))(state);

const hasKeys = (record: Readonly<Record<string, unknown>>): boolean =>
  Object.keys(record).length > 0;

/** The step's pass is over: COMPLETED with everything the harness said about it. */
const completeStep =
  (outcome: StepDoneEvent): Transition =>
  (state: State): State =>
    updateStep(outcome.step, (step: StepRecord): StepRecord => ({
      ...step,
      status: 'COMPLETED',
      completedAt: outcome.at,
      outputs: outcome.outputs,
      event: outcome.event,
      ...(hasKeys(outcome.reported) ? { reported: outcome.reported } : {}),
      ...(outcome.note ? { note: outcome.note } : {}),
      ...(outcome.sessionId === undefined ? {} : { sessionId: outcome.sessionId }),
      ...(outcome.transcriptPath === undefined ? {} : { transcriptPath: outcome.transcriptPath }),
    }))(state);

/** What the history keeps of the pass: the event and the route; the price too, per pass. */
const eventDetails = (
  outcome: StepDoneEvent,
  targets: readonly string[],
): Record<string, unknown> => ({
  event: outcome.event,
  outputs: outcome.outputs,
  targets,
  ...(outcome.note ? { note: outcome.note } : {}),
  ...(hasKeys(outcome.reported) ? { reported: outcome.reported } : {}),
  ...(outcome.sessionId === undefined ? {} : { sessionId: outcome.sessionId }),
  ...(outcome.costUsd === undefined ? {} : { costUsd: outcome.costUsd }),
  ...(outcome.usage === undefined ? {} : { usage: outcome.usage }),
  ...(outcome.durationMs === undefined ? {} : { durationMs: outcome.durationMs }),
});

const eventEntry = (
  outcome: StepDoneEvent,
  targets: readonly string[],
  refused?: string,
): HistoryDraft => {
  const arrow = `"${outcome.event}" -> [${targets.join(', ')}]`;
  const tail: string = refused === undefined ? '' : ` (refused: ${refused})`;
  return outcome.human
    ? {
        type: 'HUMAN_ANSWER',
        step: outcome.step,
        message: `Human answered "${outcome.event}" at "${outcome.step}" -> [${targets.join(', ')}].${tail}`,
        details: eventDetails(outcome, targets),
      }
    : {
        type: 'STEP_EVENT',
        step: outcome.step,
        message: `Step "${outcome.step}" returned ${arrow}.${tail}`,
        details: eventDetails(outcome, targets),
      };
};

/**
 * The step returned an event and the graph accepted it: close the pass, take the edge (counting
 * it, or noting the cap), route to its targets and remember who sent them there.
 */
export const routeEvent = (context: RunContext, outcome: StepDoneEvent): RunContext => {
  const route: RouteResult = routeOf(context, outcome);
  if (!route.ok) throw new Error(`routeEvent after a refused route: ${route.error}`);
  const decision: EdgeDecision = route.value;
  const next: string[] = decision.targets.filter((target: string): boolean => target !== END);
  const routed: RunContext = withState(
    flow<State>(
      (state: State): State => ({ ...state, vars: { ...(state.vars ?? {}), ...outcome.reported } }),
      takeEdge(outcome.at, outcome.step)(decision),
      completeStep(outcome),
      removeActive(outcome.step),
      reopenSkipped(next),
      addToFrontier(next),
      addCost(outcome),
      recordAt(outcome.at)(eventEntry(outcome, decision.targets)),
    ),
  )(context);
  return {
    ...routed,
    entered: {
      ...routed.entered,
      ...Object.fromEntries(
        next.map((target: string) => [
          target,
          {
            from: outcome.step,
            event: outcome.event,
            ...(outcome.note ? { note: outcome.note } : {}),
          },
        ]),
      ),
    },
  };
};

/** Every never-started step the route stranded is SKIPPED, with the route as the reason. */
export const skipStranded = (context: RunContext, outcome: StepDoneEvent): RunContext =>
  withState(
    skipStrandedSteps(requirePipeline(context))(
      outcome.at,
      `${outcome.step} returned ${outcome.event}`,
    ),
  )(context);

/** The graph refuses the event: the pass is recorded as it ended, and the run stops here. */
export const refuseRoute = (context: RunContext, outcome: StepDoneEvent): RunContext => {
  const route: RouteResult = routeOf(context, outcome);
  const reason: string = route.ok ? 'refused' : `${route.reason}: ${route.error}`;
  return haltRun(
    withState(
      flow<State>(
        completeStep(outcome),
        removeActive(outcome.step),
        addCost(outcome),
        recordAt(outcome.at)(eventEntry(outcome, [], reason)),
      ),
    )(context),
    reason,
  );
};

/** A running step that could not be done: FAILED, and nothing new starts. */
export const failStep = (
  context: RunContext,
  step: string,
  error: string,
  at: string,
): RunContext =>
  haltRun(
    withState(
      flow<State>(
        updateStep(step, (record: StepRecord): StepRecord => ({
          ...record,
          status: 'FAILED',
          completedAt: at,
          error,
        })),
        removeActive(step),
        recordAt(at)({
          type: 'STEP_FAIL',
          step,
          message: `Step "${step}" failed: ${error}.`,
          details: { error },
        }),
      ),
    )(context),
    `step "${step}" failed: ${error}`,
  );

export const timeoutMessage = (context: RunContext): string =>
  `timed out after ${Math.round(context.input.options.stepTimeoutMs / 60000)} minute(s)`;

/** Ctrl-C reached a running step: recorded as interrupted; `resume` runs it again. */
export const interruptStep = (context: RunContext, step: string, at: string): RunContext =>
  withState(
    flow<State>(
      updateStep(step, (record: StepRecord): StepRecord => ({
        ...record,
        status: 'FAILED',
        completedAt: at,
        error: INTERRUPTED,
      })),
      removeActive(step),
      recordAt(at)({
        type: 'STEP_FAIL',
        step,
        message: `Step "${step}" interrupted.`,
        details: { error: INTERRUPTED },
      }),
    ),
  )(context);

export const haltForInterrupt = (context: RunContext): RunContext => ({
  ...context,
  halt: INTERRUPTED,
});

// --- closing ----------------------------------------------------------------------------------

const failRunWith =
  (at: string, reason: string): Transition =>
  (state: State): State =>
    flow<State>(
      setStatus('FAILED'),
      recordAt(at)({
        type: 'PIPELINE_FAIL',
        message: `Pipeline failed: ${reason}`,
        details: { reason },
      }),
    )(state);

export const failRun = (context: RunContext, at: string): RunContext =>
  withState(failRunWith(at, context.halt ?? 'the run stopped'))(context);

export const failRunOnStall = (context: RunContext, at: string): RunContext => {
  const waiting: string[] = requireState(context).frontier ?? [];
  return withState(failRunWith(at, `stalled with ${waiting.join(', ')} waiting`))(context);
};

/** COMPLETED; every step never reached SKIPPED. */
export const completeRun = (context: RunContext, at: string): RunContext =>
  withState((state: State): State =>
    flow<State>(
      ...stepNamesWith('PENDING')(state).map((name: string): Transition =>
        skipStep(at)(name, 'the run finished and nothing routes here any more', true),
      ),
      setStatus('COMPLETED'),
      recordAt(at)({
        type: 'PIPELINE_COMPLETE',
        message: 'Every branch reached END and no step is running.',
      }),
    )(state),
  )(context);

/** Interrupted and every step stopped: ABORTED, snapshot kept, `resume` picks it up. */
export const abortRun = (context: RunContext, at: string): RunContext =>
  withState(
    flow<State>(
      setStatus('ABORTED'),
      recordAt(at)({
        type: 'PIPELINE_PAUSE',
        message: 'Run interrupted; resume it to go on.',
        details: { reason: INTERRUPTED },
      }),
    ),
  )(context);

/** A human step has nobody to ask: PAUSED, with the question in `pause`, until `answer`. */
export const parkRun = (context: RunContext, parked: StepParkedEvent): RunContext =>
  withState(
    flow<State>(
      setStatus('PAUSED'),
      (state: State): State => ({
        ...state,
        pause: {
          step: parked.step,
          status: 'AWAITING_INPUT',
          ask: parked.ask,
          present: parked.present,
          pausedAt: parked.at,
        },
      }),
      recordAt(parked.at)({
        type: 'PIPELINE_PAUSE',
        step: parked.step,
        message: `Waiting for a person at "${parked.step}": answer ${parked.step} <EVENT>.`,
        details: { step: parked.step },
      }),
    ),
  )(context);

export const unparkRun = (context: RunContext, at: string): RunContext =>
  withState(
    flow<State>(
      setStatus('RUNNING'),
      (state: State): State =>
        state.pause === undefined
          ? state
          : { ...state, pause: { ...state.pause, status: 'RESUMED' } },
      recordAt(at)({ type: 'PIPELINE_RESUME', message: 'A person answered; the run goes on.' }),
    ),
  )(context);

/**
 * Pick a stopped run back up: whatever was running or interrupted when it stopped goes back on the
 * frontier as PENDING and runs as a new pass. Finished steps, edge counts and reported values stand.
 */
export const requeueInterrupted = (context: RunContext, at: string): RunContext => {
  const state: State = requireState(context);
  const retry: string[] = Object.keys(state.steps)
    .sort()
    .filter((name: string): boolean =>
      ['RUNNING', 'FAILED'].includes(state.steps[name]?.status ?? ''),
    );
  const requeued: RunContext = withState(
    flow<State>(
      ...retry.map((name: string): Transition =>
        updateStep(name, (record: StepRecord): StepRecord => ({
          ...withoutKeys(['error', 'completedAt'])(record),
          status: 'PENDING',
          retryCount: (record.retryCount ?? 0) + 1,
        })),
      ),
      (current: State): State => ({ ...current, activeSteps: [] }),
      addToFrontier(retry),
      setStatus('RUNNING'),
      recordAt(at)({
        type: 'PIPELINE_RESUME',
        message: `Pipeline resumed; ${retry.length > 0 ? `retrying [${retry.join(', ')}]` : 'nothing to retry'}.`,
        details: { retry },
      }),
    ),
  )(context);
  // XState merges what assign returns into the context: a key is cleared by setting it, not by leaving it out.
  return { ...requeued, halt: undefined };
};

export const noteError = (context: RunContext, error: string): RunContext => ({
  ...context,
  error,
});

// --- the step actor ---------------------------------------------------------------------------

export const keepMaterials = (context: StepContext, materials: StepMaterials): StepContext => ({
  ...context,
  materials,
  prompt: buildStepPrompt(context.input.step, materials, context.input.pass),
});

/** The harness answered, or could not: keep what it said; a failure becomes the outcome at once. */
export const keepAnswer = (context: StepContext, output: RunStepOutput): StepContext =>
  output.ok
    ? { ...context, answers: [...context.answers, output.result] }
    : { ...context, outcome: { kind: 'failed', error: output.error } };

/** The second call, in the same session: only the event is asked for. */
export const prepareRetry = (context: StepContext): StepContext => ({
  ...context,
  attempt: context.attempt + 1,
  prompt: buildRetryPrompt(
    context.answers.at(-1)?.event,
    Object.keys(context.input.step.transitions),
  ),
});

export const noteBadAnswer = (context: StepContext): StepContext => ({
  ...context,
  outcome: {
    kind: 'failed',
    error: `returned "${context.answers.at(-1)?.event ?? ''}", which is not one of ${Object.keys(context.input.step.transitions).join(', ')}`,
  },
});

export const noteFailure = (context: StepContext, error: string): StepContext => ({
  ...context,
  outcome: { kind: 'failed', error },
});

export const noteTimeout = (context: StepContext): StepContext => ({
  ...context,
  outcome: { kind: 'timedOut' },
});

export const noteCancel = <Context extends { outcome?: unknown }>(context: Context): Context => ({
  ...context,
  outcome: { kind: 'cancelled' },
});

export const keepOutputs = <Context extends { outputs: string[] }>(
  context: Context,
  outputs: string[],
): Context => ({
  ...context,
  outputs,
});

export const noteDone = (context: StepContext): StepContext => ({
  ...context,
  outcome: { kind: 'done' },
});

export const stamp = <Context extends { at?: string }>(context: Context, at: string): Context => ({
  ...context,
  at,
});

// --- the human step actor ---------------------------------------------------------------------

export const keepHumanMaterials = (
  context: HumanContext,
  materials: StepMaterials,
): HumanContext => ({
  ...context,
  materials,
});

export const keepReply = (context: HumanContext, reply: HumanContext['reply']): HumanContext => ({
  ...context,
  reply,
  outcome: reply?.kind === 'parked' ? { kind: 'parked' } : { kind: 'answered' },
});

export const noteHumanFailure = (context: HumanContext, error: string): HumanContext => ({
  ...context,
  outcome: { kind: 'failed', error },
});
