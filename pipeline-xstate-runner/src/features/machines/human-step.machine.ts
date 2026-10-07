/**
 * One pass of a human step. No subagent: a person is asked the step's prompt with exactly the
 * step's events as options, and the runner writes the decision file later steps obey.
 *
 *   preparing ──► asking ──► stamping ──► recording ──► collectingOutputs ──► done
 *                              ├──► parked   (nobody at a terminal: the run parks, `answer` resumes it)
 *                              ├──► failed
 *                              └──► cancelled
 */
import { assign, fromPromise, sendParent, setup } from 'xstate';
import type { HumanQuestion, HumanReply } from '../../clients/human/human.types.js';
import type { PathAnchors, ResolvedStep } from '../pipeline/pipeline.types.js';
import type { StepMaterials } from '../prompt/prompt.types.js';
import type { Decision } from '../prompt/services/write-decision.service.js';
import {
  keepHumanMaterials,
  keepOutputs,
  keepReply,
  noteCancel,
  noteHumanFailure,
  stamp,
} from './machines.actions.js';
import { HUMAN_GUARDS, predicatesOf } from './machines.guards.js';
import type { HumanContext, RunEffects, RunEvent, StepEvent, StepInput } from './machines.types.js';
import { errorOf, outputOf } from './machines.utils.js';

const questionOf = (context: HumanContext): HumanQuestion => ({
  stepName: context.input.step.name,
  question: context.input.step.prompt,
  files: (context.materials?.inputs ?? []).flatMap((listing) => listing.files),
  allowedEvents: Object.keys(context.input.step.transitions),
});

const decisionOf = (context: HumanContext): Decision => {
  const reply: HumanReply | undefined = context.reply;
  return {
    event: reply?.kind === 'answered' ? reply.event : '',
    note: reply?.kind === 'answered' ? reply.note : '',
    at: context.at ?? '',
  };
};

/** The outcome, as the run machine hears it. */
const outcomeEventOf = (context: HumanContext): RunEvent => {
  const { step, pass }: StepInput = context.input;
  const at: string = context.at ?? '';
  const outcome = context.outcome ?? { kind: 'failed', error: 'no outcome' };
  const reply: HumanReply | undefined = context.reply;
  if (outcome.kind === 'answered' && reply?.kind === 'answered')
    return {
      type: 'STEP.DONE',
      step: step.name,
      pass: pass.pass,
      event: reply.event,
      reported: {},
      outputs: context.outputs,
      note: reply.note,
      human: true,
      at,
    };
  if (outcome.kind === 'parked')
    return {
      type: 'STEP.PARKED',
      step: step.name,
      pass: pass.pass,
      ask: step.prompt,
      present: [...questionOf(context).files],
      at,
    };
  if (outcome.kind === 'cancelled')
    return { type: 'STEP.CANCELLED', step: step.name, pass: pass.pass, at };
  return {
    type: 'STEP.FAILED',
    step: step.name,
    pass: pass.pass,
    error: outcome.kind === 'failed' ? outcome.error : 'no answer',
    at,
  };
};

export const createHumanStepMachine = (effects: RunEffects) =>
  setup({
    types: {
      context: {} as HumanContext,
      events: {} as StepEvent,
      input: {} as StepInput,
    },
    actors: {
      collectMaterials: fromPromise<StepMaterials, { step: ResolvedStep; anchors: PathAnchors }>(
        ({ input }) => effects.collectMaterials(input.step, input.anchors),
      ),
      ask: fromPromise<HumanReply, HumanQuestion>(({ input, signal }) =>
        effects.ask(input, signal),
      ),
      writeDecision: fromPromise<void, { step: ResolvedStep; decision: Decision }>(({ input }) =>
        effects.writeDecision(input.step, input.decision),
      ),
      collectOutputs: fromPromise<string[], { step: ResolvedStep; runDir: string }>(({ input }) =>
        effects.collectOutputs(input.step, input.runDir),
      ),
      readClock: fromPromise<string>(() => effects.now()),
    },
    guards: predicatesOf(HUMAN_GUARDS),
    actions: {
      keepMaterials: assign(({ context, event }) => keepHumanMaterials(context, outputOf(event))),
      keepReply: assign(({ context, event }) => keepReply(context, outputOf<HumanReply>(event))),
      noteFailure: assign(({ context, event }) => noteHumanFailure(context, errorOf(event))),
      noteCancel: assign(({ context }) => noteCancel(context)),
      keepOutputs: assign(({ context, event }) => keepOutputs(context, outputOf<string[]>(event))),
      stamp: assign(({ context, event }) => stamp(context, outputOf<string>(event))),
      reportOutcome: sendParent(({ context }) => outcomeEventOf(context)),
    },
  }).createMachine({
    id: 'human-step',
    context: ({ input }) => ({ input, outputs: [] }),
    initial: 'preparing',
    states: {
      preparing: {
        invoke: {
          src: 'collectMaterials',
          input: ({ context }) => ({ step: context.input.step, anchors: context.input.anchors }),
          onDone: { target: 'asking', actions: 'keepMaterials' },
          onError: { target: 'stamping', actions: 'noteFailure' },
        },
        on: { CANCEL: { target: 'stamping', actions: 'noteCancel' } },
      },
      asking: {
        invoke: {
          src: 'ask',
          input: ({ context }) => questionOf(context),
          onDone: { target: 'stamping', actions: 'keepReply' },
          onError: { target: 'stamping', actions: 'noteFailure' },
        },
        on: { CANCEL: { target: 'stamping', actions: 'noteCancel' } },
      },
      stamping: {
        invoke: {
          src: 'readClock',
          onDone: [
            { guard: 'outcomeIsAnswered', target: 'recording', actions: 'stamp' },
            { guard: 'outcomeIsParked', target: 'parked', actions: 'stamp' },
            { guard: 'outcomeIsCancelled', target: 'cancelled', actions: 'stamp' },
            { target: 'failed', actions: 'stamp' },
          ],
        },
      },
      recording: {
        invoke: {
          src: 'writeDecision',
          input: ({ context }) => ({ step: context.input.step, decision: decisionOf(context) }),
          onDone: 'collectingOutputs',
          onError: { target: 'failed', actions: 'noteFailure' },
        },
      },
      collectingOutputs: {
        invoke: {
          src: 'collectOutputs',
          input: ({ context }) => ({ step: context.input.step, runDir: context.input.runDir }),
          onDone: { target: 'done', actions: 'keepOutputs' },
          onError: { target: 'failed', actions: 'noteFailure' },
        },
      },
      done: { type: 'final', entry: 'reportOutcome' },
      parked: { type: 'final', entry: 'reportOutcome' },
      failed: { type: 'final', entry: 'reportOutcome' },
      cancelled: { type: 'final', entry: 'reportOutcome' },
    },
  });

export type HumanStepMachine = ReturnType<typeof createHumanStepMachine>;
