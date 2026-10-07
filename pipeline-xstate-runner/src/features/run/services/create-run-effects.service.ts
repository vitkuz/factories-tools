import type { HarnessClient } from '../../../clients/harness/harness.types.js';
import { errorMessage } from '../../../shared/utils/error.utils.js';
import type {
  HookPhase,
  HookReport,
  RunEffects,
  RunInput,
  RunStepOutput,
  ValidateOutput,
} from '../../machines/machines.types.js';
import { loadPipelineFactory, validatePipelineFactory } from '../../pipeline/services/index.js';
import {
  collectStepMaterialsFactory,
  collectStepOutputsFactory,
  writeDecisionFactory,
} from '../../prompt/services/index.js';
import { statePathFor } from '../../state/state.utils.js';
import type { RunDeps } from '../run.types.js';

/**
 * The machines' effects, each backed by one injected client. This is the only place where an
 * actor's promise meets the disk, a shell, a harness, a person or the clock.
 */
export const createRunEffects =
  (deps: RunDeps) =>
  (harness: HarnessClient): RunEffects => {
    const validate = validatePipelineFactory(deps.fileSystem);
    const load = loadPipelineFactory(deps.fileSystem);
    const collectMaterials = collectStepMaterialsFactory(deps.fileSystem);
    const collectOutputs = collectStepOutputsFactory(deps.fileSystem);
    const writeDecision = writeDecisionFactory(deps.fileSystem);

    const runHooks = async (
      phase: HookPhase,
      cwd: string,
      commands: readonly string[],
    ): Promise<HookReport[]> => {
      const [command, ...rest]: readonly string[] = commands;
      if (command === undefined) return [];
      deps.logger.info(`hook ${phase}: ${command}`);
      const result = await deps.shell.run(command, cwd);
      const report: HookReport = { ...result, phase };
      if (result.exitCode !== 0)
        deps.logger.warn(`hook ${phase} exited ${result.exitCode}`, {
          output: result.output.slice(-2000),
        });
      // `before` stops at the first failure (nothing has been spawned yet); `after` runs to the end.
      return result.exitCode !== 0 && phase === 'before'
        ? [report]
        : [report, ...(await runHooks(phase, cwd, rest))];
    };

    return {
      validate: async (input: RunInput): Promise<ValidateOutput> => {
        const report = validate({
          rootPath: input.rootPath,
          cwd: input.cwd,
          homePath: input.homePath,
        })(input.pipelineFile);
        const loaded = report.ok ? load(input.pipelineFile) : undefined;
        return {
          report,
          ...(loaded?.ok === true ? { pipeline: loaded.value } : {}),
          at: deps.clock.now(),
        };
      },
      makeRunDir: async (dir: string): Promise<void> => {
        if (deps.fileSystem.exists(statePathFor(dir)))
          throw new Error(
            `${dir} already holds a run: resume it, or change a param so the slug differs`,
          );
        deps.fileSystem.makeDirectory(dir);
      },
      runHooks: async (phase, cwd, commands) => ({
        reports: await runHooks(phase, cwd, commands),
        at: deps.clock.now(),
      }),
      collectMaterials: async (step, anchors) => collectMaterials(anchors)(step),
      runStep: async (request, signal): Promise<RunStepOutput> => {
        deps.logger.info(`▶ ${request.stepName}`, {
          model: request.model ?? 'default',
          ...(request.resumeSessionId === undefined ? {} : { retry: true }),
        });
        try {
          return { ok: true, result: await harness.runStep(request)(signal) };
        } catch (error: unknown) {
          return { ok: false, error: errorMessage(error) };
        }
      },
      collectOutputs: async (step, runDir) => collectOutputs(runDir)(step),
      ask: async (question, signal) => deps.human.ask(question)(signal),
      writeDecision: async (step, decision): Promise<void> => writeDecision(step, decision),
      now: async (): Promise<string> => deps.clock.now(),
    };
  };
