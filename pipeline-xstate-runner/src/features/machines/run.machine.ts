/**
 * THE RUN MACHINE — one per run, the same shape for every pipeline (PRD §7.2):
 *
 *   validating ──► resolving ──► opening ──► hooksBefore ──► running ──► hooksAfter ──► completed
 *       │              │                         │              │ ▲                 └──► failed
 *       └──────────────┴──► failed (never opened)└──► hooksAfter│ │
 *                                                               │ └── parked   (a human step, nobody to ask; `answer` resumes)
 *                                                               └──── stopped  (Ctrl-C; `resume` goes on)
 *
 * Inside `running` the context holds the state.json twin: frontier, edge counts, reported values,
 * step records. A STEP.DONE is routed by named pure guards (the four ways a route can be refused),
 * then one action moves the frontier, one skips the stranded steps and one spawns the steps that
 * are ready — one step actor per pass. Every event carries its own `at`; the machine never reads
 * a clock, so replaying the recorded events rebuilds state.json byte for byte.
 */
import { assign, enqueueActions, fromPromise, raise, setup } from 'xstate';
import type { AnyActorRef } from 'xstate';
import {
  abortRun,
  completeRun,
  failRun,
  failRunOnHook,
  failRunOnStall,
  failStep,
  haltForInterrupt,
  haltRun,
  interruptStep,
  keepHooks,
  keepValidation,
  noteError,
  openRun,
  parkRun,
  refuseRoute,
  requeueInterrupted,
  resolveRunPipeline,
  routeEvent,
  skipStranded,
  startRun,
  startSteps,
  timeoutMessage,
  unparkRun,
} from './machines.actions.js';
import { RUN_GUARDS, predicatesOf } from './machines.guards.js';
import type {
  HookPhase,
  HooksOutput,
  RunContext,
  RunEffects,
  RunEvent,
  RunInput,
  ValidateOutput,
} from './machines.types.js';
import {
  atOf,
  blownFuse,
  errorOf,
  eventOf,
  humanDoneOf,
  nextPassOf,
  outputOf,
  readyToStart,
  requirePipeline,
  requireState,
  runningActorIds,
  stepActorId,
  stepInputOf,
} from './machines.utils.js';
import { createHumanStepMachine } from './human-step.machine.js';
import { createStepMachine } from './step.machine.js';

export const createRunMachine = (effects: RunEffects) =>
  setup({
    types: {
      context: {} as RunContext,
      events: {} as RunEvent,
      input: {} as RunInput,
    },
    actors: {
      validate: fromPromise<ValidateOutput, RunInput>(({ input }) => effects.validate(input)),
      makeRunDir: fromPromise<void, string>(({ input }) => effects.makeRunDir(input)),
      runHooks: fromPromise<HooksOutput, { phase: HookPhase; cwd: string; commands: string[] }>(
        ({ input }) => effects.runHooks(input.phase, input.cwd, input.commands),
      ),
      stepActor: createStepMachine(effects),
      humanStepActor: createHumanStepMachine(effects),
    },
    guards: predicatesOf(RUN_GUARDS),
    actions: {
      // opening
      keepValidation: assign(({ context, event }) => keepValidation(context, outputOf(event))),
      noteValidationErrors: assign(({ context }) =>
        noteError(context, validationErrorsOf(context)),
      ),
      noteActorError: assign(({ context, event }) => noteError(context, errorOf(event))),
      resolvePipeline: assign(({ context }) => resolveRunPipeline(context)),
      openRun: assign(({ context }) => openRun(context)),
      keepHooks: assign(({ context, event }) => keepHooks(context, outputOf(event))),
      failRunOnHook: assign(({ context, event }) => failRunOnHook(context, outputOf(event))),
      startRun: assign(({ context, event }) => startRun(context, atOf(event))),
      // a step's life
      routeEvent: assign(({ context, event }) => routeEvent(context, eventOf(event, 'STEP.DONE'))),
      skipStranded: assign(({ context, event }) =>
        skipStranded(context, eventOf(event, 'STEP.DONE')),
      ),
      refuseRoute: assign(({ context, event }) =>
        refuseRoute(context, eventOf(event, 'STEP.DONE')),
      ),
      failStep: assign(({ context, event }) => {
        const failed = eventOf(event, 'STEP.FAILED');
        return failStep(context, failed.step, failed.error, failed.at);
      }),
      timeOutStep: assign(({ context, event }) => {
        const timedOut = eventOf(event, 'STEP.TIMED_OUT');
        return failStep(context, timedOut.step, timeoutMessage(context), timedOut.at);
      }),
      interruptStep: assign(({ context, event }) => {
        const cancelled = eventOf(event, 'STEP.CANCELLED');
        return interruptStep(context, cancelled.step, cancelled.at);
      }),
      /** Start every ready step: its record first, then its actor — or blow the fuse. */
      spawnReadySteps: enqueueActions(({ context, event, enqueue }) => {
        const ready: string[] = readyToStart(context);
        const fuse: string | undefined = blownFuse(context, ready);
        if (fuse !== undefined) {
          enqueue.assign(haltRun(context, fuse));
          return;
        }
        if (ready.length === 0) return;
        const pipeline = requirePipeline(context);
        const state = requireState(context);
        enqueue.assign(startSteps(context, ready, atOf(event)));
        ready.forEach((name: string): void => {
          enqueue.spawnChild(pipeline.steps[name]?.isHuman ? 'humanStepActor' : 'stepActor', {
            id: stepActorId(name, nextPassOf(state, name)),
            input: stepInputOf(context, name),
          });
        });
      }),
      // interruption and parking
      haltForInterrupt: assign(({ context }) => haltForInterrupt(context)),
      /** Ctrl-C: every running pass is told to stop; each reports STEP.CANCELLED in its own time. */
      cancelRunningSteps: enqueueActions(({ context, event, enqueue, self }) => {
        const children = self.getSnapshot().children as Record<string, AnyActorRef | undefined>;
        runningActorIds(requireState(context))
          .filter((id: string): boolean => children[id]?.getSnapshot().status === 'active')
          .forEach((id: string): void => {
            enqueue.sendTo(id, { type: 'CANCEL', at: atOf(event) });
          });
      }),
      abortRun: assign(({ context, event }) => abortRun(context, atOf(event))),
      parkRun: assign(({ context, event }) => parkRun(context, eventOf(event, 'STEP.PARKED'))),
      unparkRun: assign(({ context, event }) => unparkRun(context, atOf(event))),
      /** A person's answer is the outcome of the parked human step's running pass. */
      raiseAnswer: raise(({ context, event }) =>
        humanDoneOf(context, eventOf(event, 'HUMAN.ANSWER')),
      ),
      requeueInterrupted: assign(({ context, event }) => requeueInterrupted(context, atOf(event))),
      // closing
      failRun: assign(({ context, event }) => failRun(context, atOf(event))),
      failRunOnStall: assign(({ context, event }) => failRunOnStall(context, atOf(event))),
      completeRun: assign(({ context, event }) => completeRun(context, atOf(event))),
    },
  }).createMachine({
    id: 'run',
    context: ({ input }) => ({ input, openedAt: '', entered: {}, hooks: [] }),
    initial: 'validating',
    states: {
      validating: {
        invoke: {
          id: 'validate',
          src: 'validate',
          input: ({ context }) => context.input,
          onDone: [
            {
              guard: 'validationFailed',
              target: 'failed',
              actions: ['keepValidation', 'noteValidationErrors'],
            },
            { target: 'resolving', actions: 'keepValidation' },
          ],
          onError: { target: 'failed', actions: 'noteActorError' },
        },
      },
      resolving: {
        entry: 'resolvePipeline',
        always: [{ guard: 'resolutionFailed', target: 'failed' }, { target: 'opening' }],
      },
      opening: {
        entry: 'openRun',
        invoke: {
          id: 'makeRunDir',
          src: 'makeRunDir',
          input: ({ context }) => requirePipeline(context).outputDir,
          onDone: 'hooksBefore',
          onError: { target: 'failed', actions: 'noteActorError' },
        },
      },
      hooksBefore: {
        invoke: {
          id: 'hooksBefore',
          src: 'runHooks',
          input: ({ context }) => ({
            phase: 'before' as const,
            cwd: context.input.rootPath,
            commands: requirePipeline(context).hooks.before,
          }),
          onDone: [
            {
              guard: 'hooksFailed',
              target: 'hooksAfter',
              actions: ['keepHooks', 'failRunOnHook'],
            },
            { target: 'running', actions: ['keepHooks', 'startRun'] },
          ],
          onError: { target: 'failed', actions: 'noteActorError' },
        },
      },
      running: {
        entry: 'spawnReadySteps',
        on: {
          'STEP.DONE': [
            { guard: 'outcomeIsStale' },
            { guard: 'eventIsUnknown', actions: 'refuseRoute' },
            { guard: 'conditionIsInvalid', actions: 'refuseRoute' },
            { guard: 'fallbackIsMissing', actions: 'refuseRoute' },
            { guard: 'capIsSpent', actions: 'refuseRoute' },
            { actions: ['routeEvent', 'skipStranded', 'spawnReadySteps'] },
          ],
          'STEP.FAILED': [{ guard: 'outcomeIsStale' }, { actions: 'failStep' }],
          'STEP.TIMED_OUT': [{ guard: 'outcomeIsStale' }, { actions: 'timeOutStep' }],
          'STEP.CANCELLED': [{ guard: 'outcomeIsStale' }, { actions: 'interruptStep' }],
          'STEP.PARKED': [{ guard: 'outcomeIsStale' }, { target: 'parked', actions: 'parkRun' }],
          CANCEL: { actions: ['haltForInterrupt', 'cancelRunningSteps'] },
          RESUME: { actions: ['requeueInterrupted', 'spawnReadySteps'] },
        },
        always: [
          { guard: 'runIsInterrupted', target: 'stopped', actions: 'abortRun' },
          { guard: 'runIsHalted', target: 'hooksAfter', actions: 'failRun' },
          { guard: 'runIsFinished', target: 'hooksAfter', actions: 'completeRun' },
          { guard: 'runIsStalled', target: 'hooksAfter', actions: 'failRunOnStall' },
        ],
      },
      parked: {
        on: {
          'HUMAN.ANSWER': { target: 'running', actions: ['unparkRun', 'raiseAnswer'] },
          RESUME: { target: 'running', actions: ['unparkRun', 'requeueInterrupted'] },
        },
      },
      stopped: {
        on: {
          RESUME: { target: 'running', actions: 'requeueInterrupted' },
        },
      },
      hooksAfter: {
        invoke: {
          id: 'hooksAfter',
          src: 'runHooks',
          input: ({ context }) => ({
            phase: 'after' as const,
            cwd: context.input.rootPath,
            commands: requirePipeline(context).hooks.after,
          }),
          onDone: [
            { guard: 'runCompleted', target: 'completed', actions: 'keepHooks' },
            { target: 'failed', actions: 'keepHooks' },
          ],
          onError: { target: 'failed', actions: 'noteActorError' },
        },
      },
      completed: { type: 'final' },
      failed: { type: 'final' },
    },
  });

/** The validation errors, one line each: what `run` prints when the pipeline is refused. */
const validationErrorsOf = (context: RunContext): string =>
  (context.validation?.findings ?? [])
    .filter((finding) => finding.severity === 'error')
    .map((finding) => `${finding.message}  [${finding.rule}]`)
    .join('\n');

export type RunMachine = ReturnType<typeof createRunMachine>;
