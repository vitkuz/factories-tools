import type { ResolvedStep } from '../../pipeline/pipeline.types.js';
import { collectStepOutputsFactory } from '../../prompt/services/collect-step-outputs.service.js';
import { writeDecisionFactory } from '../../prompt/services/write-decision.service.js';
import { createRunEffects } from '../services/create-run-effects.service.js';
import { driveRunFactory } from '../services/drive-run.service.js';
import { openRunDirFactory } from '../services/open-run-dir.service.js';
import type { StoredRun } from '../services/open-run-dir.service.js';
import { outcomeOf } from '../services/outcome-of.service.js';
import type { RunDeps, RunOutcome } from '../run.types.js';
import { harnessOf } from './run-pipeline.usecase.js';

export interface AnswerRequest {
  runDir: string;
  step: string;
  event: string;
  note: string;
  /** Files the person produced, relative to the run folder; the step's declared output otherwise. */
  outputs?: string[];
  harness?: string;
}

export const ANSWER_CHECKS = {
  parked: {
    id: 'run-is-parked-at-step',
    description: 'The run waits for a person at the step named.',
  },
  event: {
    id: 'answer-is-an-event',
    description: "The answer is one of the step's events, spelled as the graph spells it.",
  },
} as const;

/**
 * answer = the run is parked at this step → the answer is one of its events → write the decision
 * file → HUMAN.ANSWER sets the restored run machine in motion. Then the run goes on as usual.
 */
export const answerHumanFactory =
  (deps: RunDeps) =>
  async (request: AnswerRequest): Promise<RunOutcome> => {
    const stored = openRunDirFactory(deps)(request.runDir);
    if (!stored.ok) return { kind: 'refused', ...stored.refusal };
    const run: StoredRun = stored.value;
    const pause = run.state.pause;
    if (
      run.value !== 'parked' ||
      pause?.status !== 'AWAITING_INPUT' ||
      pause.step !== request.step
    ) {
      return {
        kind: 'refused',
        guard: ANSWER_CHECKS.parked.id,
        message:
          pause?.status === 'AWAITING_INPUT'
            ? `the run waits at "${pause.step}", not "${request.step}"`
            : `${request.runDir} is not waiting for a person`,
      };
    }
    const step: ResolvedStep | undefined = run.context.pipeline?.steps[request.step];
    const events: string[] = Object.keys(step?.transitions ?? {});
    if (step === undefined || !events.includes(request.event)) {
      return {
        kind: 'refused',
        guard: ANSWER_CHECKS.event.id,
        message: `"${request.event}" is not an event of "${request.step}": answer one of ${events.join(', ')}`,
      };
    }
    const harness = harnessOf(deps)(
      request.harness ??
        String(run.state.context.captured['harness'] ?? run.context.input.options.harness),
    );
    if (!harness.ok) return { kind: 'refused', ...harness.refusal };

    const resumed: RunDeps = { ...deps, clock: deps.clockAfter(run.state.updatedAt) };
    const at: string = resumed.clock.now();
    writeDecisionFactory(deps.fileSystem)(step, { event: request.event, note: request.note, at });
    const outputs: string[] =
      request.outputs ?? collectStepOutputsFactory(deps.fileSystem)(run.runDir)(step);
    const snapshot = await driveRunFactory(resumed)({
      effects: createRunEffects(resumed)(harness.value),
      start: { snapshot: run.snapshot.snapshot },
      kick: {
        type: 'HUMAN.ANSWER',
        step: request.step,
        event: request.event,
        note: request.note,
        outputs,
        at: resumed.clock.now(),
      },
    });
    return outcomeOf(snapshot);
  };
