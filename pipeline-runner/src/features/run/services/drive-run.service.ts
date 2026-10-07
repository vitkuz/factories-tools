import path from 'node:path';
import type { LoggerPort } from '../../../shared/types/logger.types.js';
import { flow } from '../../../shared/utils/fp.utils.js';
import type { ResolvedPipeline, ResolvedStep } from '../../pipeline/index.js';
import { completeRun, failRun, startStep } from '../run-state.utils.js';
import type { Entry, PassInfo, RunOptions, RunState, StepOutcome } from '../run.types.js';
import type { ExecuteStep } from './execute-agent-step.service.js';
import { selectReadyStepsFactory } from './select-ready-steps.service.js';
import { settleOutcome, type Settled } from './settle-outcome.service.js';
import type { StateStore } from './state-store.service.js';

export interface DriveRunDeps {
  executeAgentStep: ExecuteStep;
  executeHumanStep: ExecuteStep;
  store: StateStore;
  logger: LoggerPort;
  now: () => Date;
}

type Inflight = ReadonlyMap<string, Promise<StepOutcome>>;

interface Cursor {
  state: RunState;
  inflight: Inflight;
  halt?: string;
}

const passInfoOf = (pipeline: ResolvedPipeline, state: RunState, name: string): PassInfo => {
  const pass = state.steps[name]?.passes ?? 1;
  const enteredBy: Entry | undefined = state.context.captured.enteredBy[name];
  const feedback: string[] =
    enteredBy === undefined || pass < 2 ? [] : (state.steps[enteredBy.from]?.outputs ?? []);
  return {
    pass,
    ...(enteredBy === undefined ? {} : { enteredBy }),
    feedbackFiles: feedback.map((file: string): string => path.join(pipeline.outputDir, file)),
  };
};

/**
 * The loop that replaces "the harness remembers what to do next".
 *
 *   start everything the graph says is ready → wait for ANY one step to finish →
 *   settle it (route, record, move the frontier) → save → look again.
 *
 * Steps run in parallel and are settled one at a time, the moment each returns, so a fast branch
 * never waits for a slow sibling. Once something halts the run nothing new starts; what is
 * already running is allowed to finish and is recorded. State is saved after every transition.
 */
export const driveRunFactory =
  (deps: DriveRunDeps) => (pipeline: ResolvedPipeline, options: RunOptions) => {
    const selectReady = selectReadyStepsFactory(pipeline);
    const settle = settleOutcome(pipeline);
    const at = (): string => deps.now().toISOString();

    const persist = async (state: RunState): Promise<RunState> => {
      await deps.store.save(pipeline.outputDir, state);
      return state;
    };

    const launch = (state: RunState, name: string): Promise<StepOutcome> => {
      const step: ResolvedStep | undefined = pipeline.steps[name];
      if (step === undefined)
        return Promise.resolve({ kind: 'error', step: name, error: 'not in the graph' });
      const execute: ExecuteStep = step.isHuman ? deps.executeHumanStep : deps.executeAgentStep;
      const pass: PassInfo = passInfoOf(pipeline, state, name);
      deps.logger.info(`▶ ${name} started`, {
        pass: pass.pass,
        agent: step.agent,
        model: step.model ?? 'inherit',
      });
      return execute(step, pass, options.signal);
    };

    const fuseOf = (state: RunState, ready: readonly string[]): string | undefined => {
      const blown: string | undefined = ready.find(
        (name: string): boolean => (state.steps[name]?.passes ?? 0) >= options.maxStepPasses,
      );
      return blown === undefined
        ? undefined
        : `step "${blown}" already ran ${options.maxStepPasses} times — the fuse stopped a loop no "max" bounds`;
    };

    const close = (state: RunState, halt: string | undefined): Promise<RunState> => {
      const waiting: string[] = state.frontier.filter(
        (name: string): boolean => state.steps[name]?.status === 'PENDING',
      );
      const reason: string | undefined =
        halt ?? (waiting.length > 0 ? `stalled with ${waiting.join(', ')} waiting` : undefined);
      return persist(
        reason === undefined ? completeRun(at())(state) : failRun(at())(reason)(state),
      );
    };

    const tick = async (cursor: Cursor): Promise<RunState> => {
      const candidates: string[] =
        cursor.halt === undefined && options.signal?.aborted !== true
          ? selectReady(cursor.state)
          : [];
      const halt: string | undefined =
        cursor.halt ??
        (options.signal?.aborted === true ? 'aborted' : fuseOf(cursor.state, candidates));
      const ready: string[] = halt === undefined ? candidates : [];
      if (ready.length === 0 && cursor.inflight.size === 0) return close(cursor.state, halt);

      const started: RunState = await persist(flow(...ready.map(startStep(at())))(cursor.state));
      const inflight: Inflight = new Map([
        ...cursor.inflight,
        ...ready.map((name: string): [string, Promise<StepOutcome>] => [
          name,
          launch(started, name),
        ]),
      ]);

      const outcome: StepOutcome = await Promise.race(inflight.values());
      const settled: Settled = settle(at())(started, outcome);
      deps.logger.info(
        outcome.kind === 'event'
          ? `✔ ${outcome.step} → ${outcome.event}`
          : `✖ ${outcome.step} failed`,
        outcome.kind === 'event'
          ? {
              next: settled.state.frontier,
              ...(outcome.costUsd === undefined ? {} : { costUsd: outcome.costUsd }),
              ...(outcome.usage === undefined ? {} : { usage: outcome.usage }),
            }
          : { error: outcome.error },
      );
      await persist(settled.state);

      const nextHalt: string | undefined = halt ?? settled.halt;
      return tick({
        state: settled.state,
        inflight: new Map(
          [...inflight].filter(
            ([name]: [string, Promise<StepOutcome>]): boolean => name !== outcome.step,
          ),
        ),
        ...(nextHalt === undefined ? {} : { halt: nextHalt }),
      });
    };

    return (state: RunState): Promise<RunState> => tick({ state, inflight: new Map() });
  };
