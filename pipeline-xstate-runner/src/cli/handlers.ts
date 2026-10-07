import path from 'node:path';
import { ALL_GUARDS } from '../features/machines/machines.guards.js';
import {
  formatGuards,
  formatHarnesses,
  formatJson,
  formatReplay,
  formatRunReport,
  formatValidation,
  toValidationJson,
} from '../features/report/report.utils.js';
import type { RunDeps, RunOutcome } from '../features/run/run.types.js';
import { answerHumanFactory } from '../features/run/usecases/answer-human.usecase.js';
import { compilePipelineUsecaseFactory } from '../features/run/usecases/compile-pipeline.usecase.js';
import { replayRunFactory } from '../features/run/usecases/replay-run.usecase.js';
import { resolvePipelineUsecaseFactory } from '../features/run/usecases/resolve-pipeline.usecase.js';
import type { Resolved } from '../features/run/usecases/resolve-pipeline.usecase.js';
import { resumeRunFactory } from '../features/run/usecases/resume-run.usecase.js';
import { runPipelineFactory } from '../features/run/usecases/run-pipeline.usecase.js';
import { showRunFactory } from '../features/run/usecases/show-run.usecase.js';
import { validatePipelineUsecaseFactory } from '../features/run/usecases/validate-pipeline.usecase.js';
import type { Result } from '../shared/types/result.types.js';
import { errorMessage } from '../shared/utils/error.utils.js';
import { logger } from '../shared/utils/logger.js';
import { EXIT } from './cli.utils.js';
import type { EngineOptions, ExitCode, Output } from './cli.utils.js';
import { createDeps, runOptionsOf, settingsOf } from './composition-root.js';
import type { Settings } from './composition-root.js';
import type { Handlers } from './program.js';

const EXIT_OF: Readonly<Record<RunOutcome['kind'], ExitCode>> = {
  completed: EXIT.ok,
  failed: EXIT.failed,
  stopped: EXIT.failed,
  parked: EXIT.parked,
  refused: EXIT.refused,
};

/** A command: settings from the flags, deps from the settings, then the usecase; errors to stderr. */
const withDeps =
  (output: Output) =>
  (body: (deps: RunDeps, settings: Settings) => Promise<ExitCode>) =>
  async (options: EngineOptions): Promise<ExitCode> => {
    const settings: Result<Settings> = settingsOf(options, process.stdin.isTTY === true);
    if (!settings.ok) {
      output.err(`refused: ${settings.refusal.message}`);
      return EXIT.refused;
    }
    try {
      return await body(createDeps(settings.value), settings.value);
    } catch (error: unknown) {
      output.err(
        `error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
      return EXIT.failed;
    }
  };

/** A refusal or a value: print one, return the code. */
const printResult =
  <T>(
    output: Output,
    options: EngineOptions,
    text: (value: T) => string,
    json: (value: T) => unknown,
  ) =>
  (result: Result<T>): ExitCode => {
    if (!result.ok) {
      output.err(`refused: ${result.refusal.message}`);
      return EXIT.refused;
    }
    output.out(options.json === true ? formatJson(json(result.value)) : text(result.value));
    return EXIT.ok;
  };

/** How a run ended: its report (text or JSON) on stdout, the matching exit code. */
const printOutcome =
  (output: Output, options: EngineOptions) =>
  (outcome: RunOutcome): ExitCode => {
    if (outcome.kind === 'refused') {
      output.err(`refused: ${outcome.message}`);
      return EXIT.refused;
    }
    output.out(
      options.json === true ? formatJson(outcome.report) : formatRunReport(outcome.report),
    );
    return EXIT_OF[outcome.kind];
  };

export const createHandlers = (output: Output): Handlers => {
  const command = withDeps(output);
  return {
    validate: (pipeline, options) =>
      command(async (deps): Promise<ExitCode> => {
        const report = validatePipelineUsecaseFactory(deps)(pipeline);
        if (!report.ok) {
          output.err(`refused: ${report.refusal.message}`);
          return EXIT.refused;
        }
        output.out(
          options.json === true
            ? formatJson(toValidationJson(report.value))
            : formatValidation(report.value),
        );
        return report.value.ok ? EXIT.ok : EXIT.failed;
      })(options),

    resolve: (pipeline, options) =>
      command(async (deps): Promise<ExitCode> =>
        printResult<Resolved>(
          output,
          { ...options, json: options.prompt === undefined ? true : options.json },
          (resolved) =>
            resolved.kind === 'prompt' ? resolved.text : formatJson(resolved.pipeline),
          (resolved) =>
            resolved.kind === 'prompt' ? { prompt: resolved.text } : resolved.pipeline,
        )(
          resolvePipelineUsecaseFactory(deps)({
            pipelineRef: pipeline,
            params: options.param,
            ...(options.prompt === undefined ? {} : { prompt: options.prompt }),
          }),
        ),
      )(options),

    run: (pipeline, options) =>
      command(async (deps, settings): Promise<ExitCode> => {
        logger.info(`pipeline ${pipeline}`, { harness: settings.harness, params: options.param });
        return printOutcome(
          output,
          options,
        )(
          await runPipelineFactory(deps)({
            pipelineRef: pipeline,
            params: options.param,
            options: runOptionsOf(settings),
          }),
        );
      })(options),

    resume: (runDir, options) =>
      command(async (deps): Promise<ExitCode> =>
        printOutcome(
          output,
          options,
        )(
          await resumeRunFactory(deps)({
            runDir: path.resolve(runDir),
            ...(options.harness === undefined ? {} : { harness: options.harness }),
          }),
        ),
      )(options),

    answer: (runDir, step, event, options) =>
      command(async (deps): Promise<ExitCode> =>
        printOutcome(
          output,
          options,
        )(
          await answerHumanFactory(deps)({
            runDir: path.resolve(runDir),
            step,
            event,
            note: options.note ?? '',
            ...((options.output ?? []).length === 0 ? {} : { outputs: options.output }),
            ...(options.harness === undefined ? {} : { harness: options.harness }),
          }),
        ),
      )(options),

    show: (runDir, options) =>
      command(async (deps): Promise<ExitCode> =>
        printResult(
          output,
          { ...options, json: true },
          formatJson,
          (state) => state,
        )(showRunFactory(deps)(path.resolve(runDir))),
      )(options),

    replay: (runDir, options) =>
      command(async (deps): Promise<ExitCode> => {
        const report = replayRunFactory(deps)(path.resolve(runDir));
        const code: ExitCode = printResult(output, options, formatReplay, (value) => value)(report);
        return report.ok && !report.value.matches ? EXIT.failed : code;
      })(options),

    compile: (pipeline, options) =>
      command(async (deps): Promise<ExitCode> =>
        printResult(
          output,
          { ...options, json: true },
          formatJson,
          (chart) => chart,
        )(compilePipelineUsecaseFactory(deps)(pipeline)),
      )(options),

    listGuards: (): ExitCode => {
      output.out(formatGuards(ALL_GUARDS));
      return EXIT.ok;
    },

    listHarnesses: (options): ExitCode => {
      const settings: Result<Settings> = settingsOf(options, false);
      if (!settings.ok) {
        output.err(`refused: ${settings.refusal.message}`);
        return EXIT.refused;
      }
      try {
        output.out(formatHarnesses(createDeps(settings.value).harnesses));
        return EXIT.ok;
      } catch (error: unknown) {
        output.err(`error: ${errorMessage(error)}`);
        return EXIT.failed;
      }
    },
  };
};
