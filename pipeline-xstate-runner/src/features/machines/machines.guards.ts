// Learned from factories-tools/pipeline-state/src/features/guards/ (defineGuard: one named, described,
// pure check per refusal) — here the checks are XState guards, and --list-guards prints them.
import type { AnyEventObject } from 'xstate';
import { mapValues } from '../../shared/utils/fp.utils.js';
import { activeOf, frontierOf } from '../state/state.utils.js';
import type { State } from '../state/state.types.js';
import type {
  HooksOutput,
  HumanContext,
  HumanOutcome,
  RunContext,
  RunStepOutput,
  StepContext,
  StepOutcome,
  ValidateOutput,
} from './machines.types.js';
import { INTERRUPTED } from './machines.types.js';
import {
  eventOf,
  isStaleOutcome,
  knowsEvent,
  outputOf,
  passOf,
  readyToStart,
  requireState,
  routeOf,
} from './machines.utils.js';

export interface GuardMeta {
  /** kebab-case, unique; printed by --list-guards. */
  id: string;
  /** One sentence: what the guard says is true when it passes. */
  description: string;
}

export interface GuardArgs<Context> {
  context: Context;
  event: AnyEventObject;
}

/** One pure check. Named, so a transition reads `guard: 'capIsSpent'` and the list explains it. */
export interface NamedGuard<Context> extends GuardMeta {
  check: (args: GuardArgs<Context>) => boolean;
}

export const defineGuard =
  <Context>(meta: GuardMeta) =>
  (check: (args: GuardArgs<Context>) => boolean): NamedGuard<Context> => ({ ...meta, check });

/** What `setup({ guards })` takes: the predicates, by the same keys. */
export const predicatesOf = <K extends string, Context>(
  guards: Readonly<Record<K, NamedGuard<Context>>>,
): Record<K, (args: GuardArgs<Context>) => boolean> =>
  mapValues((guard: NamedGuard<Context>) => guard.check)(guards) as Record<
    K,
    (args: GuardArgs<Context>) => boolean
  >;

const routeFails =
  (reason: string) =>
  ({ context, event }: GuardArgs<RunContext>): boolean => {
    const route = routeOf(context, eventOf(event, 'STEP.DONE'));
    return !route.ok && route.reason === reason;
  };

const nothingRunning = (state: State): boolean => activeOf(state).length === 0;

// --- the run machine --------------------------------------------------------------------------

export const RUN_GUARDS = {
  validationFailed: defineGuard<RunContext>({
    id: 'validation-failed',
    description: 'The pipeline has validation errors: the run never opens (exit 2).',
  })(({ event }) => !outputOf<ValidateOutput>(event).report.ok),

  resolutionFailed: defineGuard<RunContext>({
    id: 'resolution-failed',
    description: 'A param is unknown, mistyped or missing: the run never opens (exit 2).',
  })(({ context }) => context.error !== undefined),

  hooksFailed: defineGuard<RunContext>({
    id: 'hooks-failed',
    description: 'A hooks.before command exited non-zero: the run fails before any agent starts.',
  })(({ event }) => outputOf<HooksOutput>(event).reports.some((hook) => hook.exitCode !== 0)),

  outcomeIsStale: defineGuard<RunContext>({
    id: 'outcome-is-stale',
    description:
      'The outcome belongs to a pass that is no longer running (cancelled or started again): it is ignored.',
  })(({ context, event }) => isStaleOutcome(requireState(context), passOf(event))),

  eventIsUnknown: defineGuard<RunContext>({
    id: 'event-is-unknown',
    description: "The returned event is not a key of the step's transitions: the run stops.",
  })(routeFails('unknown-event')),

  conditionIsInvalid: defineGuard<RunContext>({
    id: 'condition-is-invalid',
    description:
      "The edge's condition cannot be evaluated (bad syntax, or a name nothing reported or declared): the run stops.",
  })(routeFails('bad-condition')),

  fallbackIsMissing: defineGuard<RunContext>({
    id: 'fallback-is-missing',
    description: 'The condition is false and the step has no unconditional edge: the run stops.',
  })(routeFails('no-fallback')),

  capIsSpent: defineGuard<RunContext>({
    id: 'cap-is-spent',
    description: 'The edge taken has used up its max and has no onMax: the run stops.',
  })(routeFails('cap-spent')),

  runIsInterrupted: defineGuard<RunContext>({
    id: 'run-is-interrupted',
    description:
      'Ctrl-C was pressed and every running step has stopped: the run is ABORTED, resumable.',
  })(({ context }) => context.halt === INTERRUPTED && nothingRunning(requireState(context))),

  runIsHalted: defineGuard<RunContext>({
    id: 'run-is-halted',
    description:
      'A failed step, a refused route or the fuse stopped the run and nothing is running any more: FAILED.',
  })(
    ({ context }) =>
      context.halt !== undefined &&
      context.halt !== INTERRUPTED &&
      nothingRunning(requireState(context)),
  ),

  runIsFinished: defineGuard<RunContext>({
    id: 'run-is-finished',
    description: 'Nothing is running and nothing is routed: every branch reached END, COMPLETED.',
  })(({ context }) => {
    const state: State = requireState(context);
    return context.halt === undefined && nothingRunning(state) && frontierOf(state).length === 0;
  }),

  runIsStalled: defineGuard<RunContext>({
    id: 'run-is-stalled',
    description: 'Steps are routed, none may start and nothing runs: the graph is stuck, FAILED.',
  })(({ context }) => {
    const state: State = requireState(context);
    return (
      context.halt === undefined &&
      nothingRunning(state) &&
      frontierOf(state).length > 0 &&
      readyToStart(context).length === 0
    );
  }),

  runCompleted: defineGuard<RunContext>({
    id: 'run-completed',
    description: 'The run is COMPLETED once hooks.after have run: exit 0.',
  })(({ context }) => requireState(context).status === 'COMPLETED'),
} as const;

// --- the step actor ---------------------------------------------------------------------------

const outcomeIs =
  <Context extends { outcome?: { kind: string } }>(kind: string) =>
  ({ context }: GuardArgs<Context>): boolean =>
    context.outcome?.kind === kind;

const lastOutput = (context: StepContext): RunStepOutput | undefined =>
  context.answers.length === 0 ? undefined : { ok: true, result: context.answers.at(-1)! };

export const STEP_GUARDS = {
  callFailed: defineGuard<StepContext>({
    id: 'call-failed',
    description:
      'The harness gave no result (process error, killed, unreadable output): the step fails.',
  })(({ context }) => context.outcome?.kind === 'failed'),

  answerIsKnown: defineGuard<StepContext>({
    id: 'answer-is-known',
    description: "The answer names one of the step's events.",
  })(({ context }) => knowsEvent(context.input.step, context.answers.at(-1)?.event)),

  canRetry: defineGuard<StepContext>({
    id: 'can-retry',
    description:
      'The answer named no known event, the harness gave a session id and this was the first call: ask once more in the same session.',
  })(
    ({ context }) =>
      context.attempt === 1 &&
      lastOutput(context)?.ok === true &&
      context.answers.at(-1)?.sessionId !== undefined,
  ),

  outcomeIsDone: defineGuard<StepContext>({
    id: 'outcome-is-done',
    description: 'The pass ended with a known event and its outputs collected.',
  })(outcomeIs<StepContext>('done' satisfies StepOutcome['kind'])),

  outcomeIsFailed: defineGuard<StepContext>({
    id: 'outcome-is-failed',
    description:
      'The pass could not be done: a harness error, or two answers without a known event.',
  })(outcomeIs<StepContext>('failed' satisfies StepOutcome['kind'])),

  outcomeIsTimedOut: defineGuard<StepContext>({
    id: 'outcome-is-timed-out',
    description: 'The pass ran longer than --step-timeout: the harness was killed.',
  })(outcomeIs<StepContext>('timedOut' satisfies StepOutcome['kind'])),

  outcomeIsCancelled: defineGuard<StepContext>({
    id: 'outcome-is-cancelled',
    description: 'The run was interrupted while the pass ran.',
  })(outcomeIs<StepContext>('cancelled' satisfies StepOutcome['kind'])),
} as const;

// --- the human step actor ---------------------------------------------------------------------

export const HUMAN_GUARDS = {
  replyWasParked: defineGuard<HumanContext>({
    id: 'reply-was-parked',
    description: 'Nobody is at a terminal: the run parks until `answer` is called (exit 3).',
  })(({ context }) => context.reply?.kind === 'parked'),

  outcomeIsAnswered: defineGuard<HumanContext>({
    id: 'answer-is-given',
    description: "A person answered with one of the step's events; the decision file is written.",
  })(outcomeIs<HumanContext>('answered' satisfies HumanOutcome['kind'])),

  outcomeIsParked: defineGuard<HumanContext>({
    id: 'question-is-parked',
    description: 'The question is parked for `answer`.',
  })(outcomeIs<HumanContext>('parked' satisfies HumanOutcome['kind'])),

  outcomeIsFailed: defineGuard<HumanContext>({
    id: 'question-failed',
    description: 'The person could not be asked or the decision could not be written.',
  })(outcomeIs<HumanContext>('failed' satisfies HumanOutcome['kind'])),

  outcomeIsCancelled: defineGuard<HumanContext>({
    id: 'question-cancelled',
    description: 'The run was interrupted while the question was open.',
  })(outcomeIs<HumanContext>('cancelled' satisfies HumanOutcome['kind'])),
} as const;

/** Every guard of every machine, for --list-guards, in the order it is written. */
export const ALL_GUARDS: readonly { machine: string; guards: readonly GuardMeta[] }[] = [
  { machine: 'run', guards: Object.values(RUN_GUARDS) },
  { machine: 'step', guards: Object.values(STEP_GUARDS) },
  { machine: 'human-step', guards: Object.values(HUMAN_GUARDS) },
];
