import type { FileSystemAdapter } from '../../../adapters/file-system/index.js';
import { errorMessage } from '../../../shared/utils/error.utils.js';
import { isGlob } from '../../pipeline/index.js';
import type { ResolvedPipeline, ResolvedStep } from '../../pipeline/index.js';
import type { HumanAnswer, HumanPort, StepOutcome } from '../run.types.js';
import { collectStepMaterialsFactory } from './collect-step-materials.service.js';
import { collectOutputsFactory, type ExecuteStep } from './execute-agent-step.service.js';

export interface ExecuteHumanStepDeps {
  human: HumanPort;
  fileSystem: FileSystemAdapter;
}

const decisionFile = (step: ResolvedStep, answer: HumanAnswer, at: string): string =>
  [
    `# Decision — ${step.name}`,
    '',
    `- **Answer:** ${answer.event}`,
    `- **At:** ${at}`,
    '',
    '## Note',
    '',
    answer.note === '' ? '_none_' : answer.note,
    '',
  ].join('\n');

/**
 * A human step is not a subagent: the person is asked the step's prompt, offered exactly the
 * step's events, and the runner — not an agent — writes the decision file later steps obey.
 */
export const executeHumanStepFactory =
  (deps: ExecuteHumanStepDeps, now: () => Date) =>
  (pipeline: ResolvedPipeline): ExecuteStep => {
    const collectMaterials = collectStepMaterialsFactory(deps.fileSystem);
    const collectOutputs = collectOutputsFactory(deps.fileSystem, pipeline.outputDir);

    return async (step: ResolvedStep): Promise<StepOutcome> => {
      try {
        const { inputs } = await collectMaterials(step);
        const answer: HumanAnswer = await deps.human.ask({
          stepName: step.name,
          question: step.prompt,
          files: inputs.flatMap(({ files }): string[] => files),
          allowedEvents: Object.keys(step.transitions),
        });
        const target: string | undefined = step.output.find(
          (file: string): boolean => !isGlob(file),
        );
        if (target !== undefined)
          await deps.fileSystem.writeText(target, decisionFile(step, answer, now().toISOString()));
        return {
          kind: 'event',
          step: step.name,
          event: answer.event,
          reported: {},
          note: answer.note,
          outputs: await collectOutputs(step),
          human: true,
        };
      } catch (error) {
        return { kind: 'error', step: step.name, error: errorMessage(error) };
      }
    };
  };
