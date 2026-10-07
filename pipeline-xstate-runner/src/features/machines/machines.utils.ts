import type { AnyEventObject } from 'xstate';
import path from 'node:path';
import type { AgentRequest } from '../../clients/harness/harness.types.js';
import type { ResolvedPipeline, ResolvedStep } from '../pipeline/pipeline.types.js';
import type { PassInfo } from '../prompt/prompt.types.js';
import { buildStepPrompt } from '../prompt/services/build-step-prompt.service.js';
import { lookupIn, readinessOf, resolveEdge, scopesOf } from '../routing/index.js';
import type { RouteResult } from '../routing/index.js';
import type { State } from '../state/state.types.js';
import { activeOf } from '../state/state.utils.js';
import type {
  Entered,
  HumanAnswerEvent,
  RunContext,
  RunEvent,
  RunEventType,
  StepContext,
  StepDoneEvent,
  StepInput,
} from './machines.types.js';

// --- events -----------------------------------------------------------------------------------

/** `step:review#2`: the actor of one pass of one step. */
export const stepActorId = (step: string, pass: number): string => `step:${step}#${pass}`;

/**
 * The event, narrowed to the type the transition guarantees. XState hands named guards and actions
 * the machine's event union; this says which member a handler was wired to.
 */
export const eventOf = <T extends RunEventType>(
  event: AnyEventObject,
  type: T,
): Extract<RunEvent, { type: T }> => {
  if (event.type !== type) throw new Error(`expected a ${type} event, got ${event.type}`);
  return event as Extract<RunEvent, { type: T }>;
};

/** A field of an event, read without a claim about the event's shape. */
const fieldOf = (event: AnyEventObject, key: string): unknown =>
  (event as Record<string, unknown>)[key];

/** The output of an invoked actor's done event. */
export const outputOf = <T>(event: AnyEventObject): T => fieldOf(event, 'output') as T;

/** The step and pass an outcome event speaks of. */
export const passOf = (event: AnyEventObject): { step: string; pass: number } => {
  const step: unknown = fieldOf(event, 'step');
  const pass: unknown = fieldOf(event, 'pass');
  if (typeof step !== 'string' || typeof pass !== 'number')
    throw new Error(`event ${event.type} names no step pass`);
  return { step, pass };
};

/** The error of an invoked actor's error event, in words. */
export const errorOf = (event: AnyEventObject): string => {
  const error: unknown = fieldOf(event, 'error');
  return error instanceof Error ? error.message : String(error);
};

/** When the event happened: its own `at`, or the `at` of the actor output that carries it. */
export const atOf = (event: AnyEventObject): string => {
  const own: unknown = fieldOf(event, 'at');
  if (typeof own === 'string') return own;
  const fromOutput: unknown = (fieldOf(event, 'output') as { at?: unknown } | undefined)?.at;
  if (typeof fromOutput === 'string') return fromOutput;
  throw new Error(`event ${event.type} carries no timestamp`);
};

// --- context ----------------------------------------------------------------------------------

export const requireState = (context: RunContext): State => {
  if (context.state === undefined) throw new Error('the run has no state yet');
  return context.state;
};

export const requirePipeline = (context: RunContext): ResolvedPipeline => {
  if (context.pipeline === undefined) throw new Error('the pipeline is not resolved yet');
  return context.pipeline;
};

export const requireStep = (pipeline: ResolvedPipeline, name: string): ResolvedStep => {
  const step: ResolvedStep | undefined = pipeline.steps[name];
  if (step === undefined) throw new Error(`"${name}" is not a step of ${pipeline.id}`);
  return step;
};

/** The pass a step is about to start: one more than it has run. */
export const nextPassOf = (state: State, name: string): number =>
  (state.steps[name]?.passes ?? 0) + 1;

/** What the step is told about why it runs again: who sent the work back and what they wrote. */
export const passInfoOf = (context: RunContext, name: string): PassInfo => {
  const state: State = requireState(context);
  const pipeline: ResolvedPipeline = requirePipeline(context);
  const pass: number = nextPassOf(state, name);
  const entered: Entered | undefined = context.entered[name];
  const feedback: string[] =
    entered === undefined || pass < 2 ? [] : (state.steps[entered.from]?.outputs ?? []);
  return {
    pass,
    ...(entered === undefined ? {} : { enteredBy: { from: entered.from, event: entered.event } }),
    feedbackFiles: feedback.map((file: string): string => path.join(pipeline.outputDir, file)),
    ...(entered?.note === undefined ? {} : { revisionNote: entered.note }),
  };
};

export const stepInputOf = (context: RunContext, name: string): StepInput => {
  const pipeline: ResolvedPipeline = requirePipeline(context);
  return {
    step: requireStep(pipeline, name),
    pass: passInfoOf(context, name),
    runDir: pipeline.outputDir,
    anchors: pipeline.anchors,
    stepTimeoutMs: context.input.options.stepTimeoutMs,
  };
};

/** The routed steps that may start now: none once something halted the run. */
export const readyToStart = (context: RunContext): string[] =>
  context.halt === undefined
    ? readinessOf(requirePipeline(context))(requireState(context)).ready
    : [];

/** The fuse: a step about to start more often than --max-step-passes allows. */
export const blownFuse = (context: RunContext, ready: readonly string[]): string | undefined => {
  const state: State = requireState(context);
  const limit: number = context.input.options.maxStepPasses;
  const blown: string | undefined = ready.find(
    (name: string): boolean => (state.steps[name]?.passes ?? 0) >= limit,
  );
  return blown === undefined
    ? undefined
    : `step "${blown}" already ran ${limit} times: the fuse stopped a loop no "max" bounds`;
};

/** The actors of every running pass: who gets a CANCEL. */
export const runningActorIds = (state: State): string[] =>
  activeOf(state).map((name: string): string => stepActorId(name, state.steps[name]?.passes ?? 1));

/** True when the outcome belongs to a pass that is not the one running: it is ignored. */
export const isStaleOutcome = (state: State, outcome: { step: string; pass: number }): boolean => {
  const record = state.steps[outcome.step];
  return record === undefined || record.status !== 'RUNNING' || record.passes !== outcome.pass;
};

/** Where the event this outcome reports goes, judged on the state with its reported values merged in. */
export const routeOf = (context: RunContext, outcome: StepDoneEvent): RouteResult => {
  const pipeline: ResolvedPipeline = requirePipeline(context);
  const state: State = requireState(context);
  const merged: State = { ...state, vars: { ...(state.vars ?? {}), ...outcome.reported } };
  return resolveEdge(pipeline)(
    lookupIn(scopesOf(pipeline, merged, pipeline.outputDir)),
    merged.edges ?? {},
  )(outcome.step, outcome.event);
};

/** A person's answer, as the outcome of the human step's running pass. */
export const humanDoneOf = (context: RunContext, answer: HumanAnswerEvent): StepDoneEvent => ({
  type: 'STEP.DONE',
  step: answer.step,
  pass: requireState(context).steps[answer.step]?.passes ?? 1,
  event: answer.event,
  reported: {},
  outputs: answer.outputs,
  note: answer.note,
  human: true,
  at: answer.at,
});

// --- the step actor ---------------------------------------------------------------------------

/** The harness request of the current call: the step's prompt, or the retry's in the same session. */
export const requestOf = (context: StepContext): AgentRequest => {
  const { step, runDir, anchors }: StepInput = context.input;
  const previous = context.answers.at(-1);
  return {
    stepName: step.name,
    prompt:
      context.prompt ??
      buildStepPrompt(step, context.materials ?? emptyMaterials(), context.input.pass),
    ...(step.systemPrompt === undefined ? {} : { systemPrompt: step.systemPrompt }),
    ...(step.model === undefined ? {} : { model: step.model }),
    ...(context.materials?.agentProfile === undefined
      ? {}
      : { agentProfile: context.materials.agentProfile }),
    cwd: anchors.rootPath,
    runDir,
    allowedEvents: Object.keys(step.transitions),
    ...(context.attempt > 1 && previous?.sessionId !== undefined
      ? { resumeSessionId: previous.sessionId }
      : {}),
  };
};

const emptyMaterials = (): StepContext['materials'] & object => ({
  knowledge: [],
  missingKnowledge: [],
  inputs: [],
  notes: [],
});

export const knowsEvent = (step: ResolvedStep, event: string | undefined): boolean =>
  event !== undefined && Object.hasOwn(step.transitions, event);
