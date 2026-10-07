/**
 * One pass of one agent step, spawned by the run machine:
 *
 *   preparing ──► running ──► validatingAnswer ──► collectingOutputs ──► stamping ──► done
 *                   ▲              │ (no known event, a session, first call)
 *                   └── retrying ◄─┘                                       ├──► failed
 *   running ──after stepTimeout──────────────────────────────────────────► ├──► timedOut
 *   any ──CANCEL─────────────────────────────────────────────────────────► └──► cancelled
 *
 * Every side effect is an invoked actor backed by an injected effect; `stamping` reads the clock
 * once, so the outcome sent to the parent carries its own `at`. Actions only assign.
 */
import { assign, fromPromise, sendParent, setup } from 'xstate';
import type { AgentRequest } from '../../clients/harness/harness.types.js';
import type { PathAnchors, ResolvedStep } from '../pipeline/pipeline.types.js';
import type { StepMaterials } from '../prompt/prompt.types.js';
import {
  keepAnswer,
  keepMaterials,
  keepOutputs,
  noteBadAnswer,
  noteCancel,
  noteDone,
  noteFailure,
  noteTimeout,
  prepareRetry,
  stamp,
} from './machines.actions.js';
import { STEP_GUARDS, predicatesOf } from './machines.guards.js';
import type {
  RunEffects,
  RunEvent,
  RunStepOutput,
  StepContext,
  StepEvent,
  StepInput,
} from './machines.types.js';
import { atOf, errorOf, outputOf, requestOf } from './machines.utils.js';

/** The outcome, as the run machine hears it. */
const outcomeEventOf = (context: StepContext): RunEvent => {
  const { step, pass }: StepInput = context.input;
  const at: string = context.at ?? '';
  const outcome = context.outcome ?? { kind: 'failed', error: 'no outcome' };
  if (outcome.kind === 'done') {
    const answers = context.answers;
    const last = answers.at(-1);
    const first = answers[0];
    const priced = answers.filter((answer) => answer.costUsd !== undefined);
    const metered = answers.filter((answer) => answer.usage !== undefined);
    const sessionId: string | undefined = first?.sessionId ?? last?.sessionId;
    const transcriptPath: string | undefined = first?.transcriptPath ?? last?.transcriptPath;
    return {
      type: 'STEP.DONE',
      step: step.name,
      pass: pass.pass,
      event: last?.event ?? '',
      reported: answers.reduce((all, answer) => ({ ...all, ...answer.reported }), {}),
      outputs: context.outputs,
      note: (context.materials?.notes ?? []).join('; '),
      human: false,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(transcriptPath === undefined ? {} : { transcriptPath }),
      ...(priced.length === 0
        ? {}
        : { costUsd: priced.reduce((sum, answer) => sum + (answer.costUsd ?? 0), 0) }),
      ...(metered.length === 0
        ? {}
        : {
            usage: metered.reduce(
              (sum, answer) =>
                Object.fromEntries(
                  [...new Set([...Object.keys(sum), ...Object.keys(answer.usage ?? {})])].map(
                    (key) => [
                      key,
                      ((sum as Record<string, number>)[key] ?? 0) +
                        ((answer.usage as Record<string, number> | undefined)?.[key] ?? 0),
                    ],
                  ),
                ),
              {},
            ),
          }),
      ...(first?.durationMs === undefined ? {} : { durationMs: first.durationMs }),
      at,
    };
  }
  if (outcome.kind === 'failed')
    return { type: 'STEP.FAILED', step: step.name, pass: pass.pass, error: outcome.error, at };
  if (outcome.kind === 'timedOut')
    return { type: 'STEP.TIMED_OUT', step: step.name, pass: pass.pass, at };
  return { type: 'STEP.CANCELLED', step: step.name, pass: pass.pass, at };
};

export const createStepMachine = (effects: RunEffects) =>
  setup({
    types: {
      context: {} as StepContext,
      events: {} as StepEvent,
      input: {} as StepInput,
    },
    actors: {
      collectMaterials: fromPromise<StepMaterials, { step: ResolvedStep; anchors: PathAnchors }>(
        ({ input }) => effects.collectMaterials(input.step, input.anchors),
      ),
      runStep: fromPromise<RunStepOutput, AgentRequest>(({ input, signal }) =>
        effects.runStep(input, signal),
      ),
      collectOutputs: fromPromise<string[], { step: ResolvedStep; runDir: string }>(({ input }) =>
        effects.collectOutputs(input.step, input.runDir),
      ),
      readClock: fromPromise<string>(() => effects.now()),
    },
    guards: predicatesOf(STEP_GUARDS),
    actions: {
      keepMaterials: assign(({ context, event }) => keepMaterials(context, outputOf(event))),
      keepAnswer: assign(({ context, event }) => keepAnswer(context, outputOf(event))),
      prepareRetry: assign(({ context }) => prepareRetry(context)),
      noteBadAnswer: assign(({ context }) => noteBadAnswer(context)),
      noteFailure: assign(({ context, event }) => noteFailure(context, errorOf(event))),
      noteTimeout: assign(({ context }) => noteTimeout(context)),
      noteCancel: assign(({ context }) => noteCancel(context)),
      keepOutputs: assign(({ context, event }) =>
        noteDone(keepOutputs(context, outputOf<string[]>(event))),
      ),
      stamp: assign(({ context, event }) => stamp(context, outputOf<string>(event))),
      reportOutcome: sendParent(({ context }) => outcomeEventOf(context)),
    },
    delays: {
      stepTimeout: ({ context }) => context.input.stepTimeoutMs,
    },
  }).createMachine({
    id: 'step',
    context: ({ input }) => ({ input, attempt: 1, answers: [], outputs: [] }),
    initial: 'preparing',
    states: {
      preparing: {
        invoke: {
          src: 'collectMaterials',
          input: ({ context }) => ({ step: context.input.step, anchors: context.input.anchors }),
          onDone: { target: 'running', actions: 'keepMaterials' },
          onError: { target: 'stamping', actions: 'noteFailure' },
        },
        on: { CANCEL: { target: 'stamping', actions: 'noteCancel' } },
      },
      running: {
        invoke: {
          src: 'runStep',
          input: ({ context }) => requestOf(context),
          onDone: { target: 'validatingAnswer', actions: 'keepAnswer' },
          onError: { target: 'stamping', actions: 'noteFailure' },
        },
        after: { stepTimeout: { target: 'stamping', actions: 'noteTimeout' } },
        on: { CANCEL: { target: 'stamping', actions: 'noteCancel' } },
      },
      validatingAnswer: {
        always: [
          { guard: 'callFailed', target: 'stamping' },
          { guard: 'answerIsKnown', target: 'collectingOutputs' },
          { guard: 'canRetry', target: 'retrying' },
          { target: 'stamping', actions: 'noteBadAnswer' },
        ],
      },
      retrying: {
        entry: 'prepareRetry',
        always: 'running',
      },
      collectingOutputs: {
        invoke: {
          src: 'collectOutputs',
          input: ({ context }) => ({ step: context.input.step, runDir: context.input.runDir }),
          onDone: { target: 'stamping', actions: 'keepOutputs' },
          onError: { target: 'stamping', actions: 'noteFailure' },
        },
        on: { CANCEL: { target: 'stamping', actions: 'noteCancel' } },
      },
      stamping: {
        invoke: {
          src: 'readClock',
          onDone: [
            { guard: 'outcomeIsDone', target: 'done', actions: 'stamp' },
            { guard: 'outcomeIsTimedOut', target: 'timedOut', actions: 'stamp' },
            { guard: 'outcomeIsCancelled', target: 'cancelled', actions: 'stamp' },
            { target: 'failed', actions: 'stamp' },
          ],
        },
      },
      done: { type: 'final', entry: 'reportOutcome' },
      failed: { type: 'final', entry: 'reportOutcome' },
      timedOut: { type: 'final', entry: 'reportOutcome' },
      cancelled: { type: 'final', entry: 'reportOutcome' },
    },
  });

export type StepMachine = ReturnType<typeof createStepMachine>;

/** Only here so the helper reads the same event timestamps the run machine does. */
export const stepEventAt = atOf;
