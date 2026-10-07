import path from 'node:path';
import type { Command } from 'commander';
import {
  harnessSchema,
  permissionModeSchema,
  unmappedTiers,
  type Harness,
  type PermissionMode,
} from '../../features/harness/index.js';
import type {
  ModelAlias,
  ResolvedPipeline,
  ResolvedStep,
  Scalar,
} from '../../features/pipeline/index.js';
import type { RunPipeline, RunReport, RunState } from '../../features/run/index.js';
import { createAppError } from '../../shared/utils/error.utils.js';
import { collectParam, formatReport } from '../cli.utils.js';
import {
  createBaseContainer,
  createContainer,
  type BaseContainer,
  type Container,
} from '../composition-root.js';

interface EngineOptions {
  root: string;
  maxStepPasses: string;
  harness?: string;
  defaultModel?: string;
  permissionMode?: string;
  stepTimeout?: string;
  json: boolean;
}

interface RunOptions extends EngineOptions {
  param: Record<string, string>;
  slug?: string;
}

/** A flag is text someone typed: it is checked against the names that exist before it is used. */
const oneOf =
  <T extends string>(flag: string, names: readonly T[]) =>
  (value: string | undefined): T | undefined => {
    if (value === undefined || (names as readonly string[]).includes(value)) return value as T;
    throw createAppError('HARNESS_INVALID', `${flag} does not take "${value}"`, [
      `one of: ${names.join(', ')}`,
    ]);
  };

const harnessOf = oneOf<Harness>('--harness', harnessSchema.options);
const permissionModeOf = oneOf<PermissionMode>('--permission-mode', permissionModeSchema.options);

/** `recorded` is the harness a resumed run started on; `--harness` still wins over it. */
const containerFor = (options: EngineOptions, recorded?: string): Container => {
  const harness: Harness | undefined = harnessOf(options.harness ?? recorded);
  const permissionMode: PermissionMode | undefined = permissionModeOf(options.permissionMode);
  return createContainer({
    ...(harness === undefined ? {} : { harness }),
    ...(options.defaultModel === undefined ? {} : { defaultModel: options.defaultModel }),
    ...(permissionMode === undefined ? {} : { permissionMode }),
    ...(options.stepTimeout === undefined
      ? {}
      : { stepTimeoutMinutes: Number(options.stepTimeout) }),
  });
};

/** One warning, at load: the tiers this pipeline names that the chosen harness has no model for. */
const warnUnmappedTiers = (container: Container, pipeline: ResolvedPipeline): void => {
  if (container.harness === 'claude') return; // a tier is Claude's own alias
  const tiers: ModelAlias[] = unmappedTiers(
    Object.values(pipeline.steps).map((step: ResolvedStep): ModelAlias | undefined => step.model),
    container.models,
  );
  if (tiers.length > 0)
    container.logger.warn(
      `${container.harness} has no model mapped for ${tiers.join(', ')} — those steps run on its default model; map them in ${container.harness.toUpperCase()}_MODELS`,
    );
};

/** Ctrl-C stops the agents and records the run as failed — so it can be resumed, not lost. */
const abortOnInterrupt = (container: Container): AbortSignal => {
  const controller: AbortController = new AbortController();
  process.once('SIGINT', (): void => {
    container.logger.warn('interrupted — stopping the running steps and recording the run');
    controller.abort();
  });
  return controller.signal;
};

const drive = async (
  container: Container,
  execute: RunPipeline,
  pipeline: ResolvedPipeline,
  options: EngineOptions,
): Promise<void> => {
  pipeline.warnings.forEach((warning: string): void => container.logger.warn(warning));
  warnUnmappedTiers(container, pipeline);
  container.logger.info(`pipeline ${pipeline.id}`, {
    harness: container.harness,
    outputDir: pipeline.outputDir,
    params: pipeline.params,
  });
  const report: RunReport = await execute(pipeline, {
    maxStepPasses: Number(options.maxStepPasses),
    signal: abortOnInterrupt(container),
  });
  process.stdout.write(
    `${options.json ? JSON.stringify(report, null, 2) : formatReport(report)}\n`,
  );
  process.exitCode = report.status === 'COMPLETED' ? 0 : 1;
};

const withEngineOptions = (command: Command): Command =>
  command
    .option('--root <dir>', 'the repository root', process.cwd())
    .option(
      '--max-step-passes <n>',
      'fuse: fail the run when one step would start more often than this',
      '12',
    )
    .option('--harness <name>', 'claude | codex | copilot | agy (default: env, then claude)')
    .option('--default-model <id>', 'the model for steps that name none (default: env)')
    .option(
      '--permission-mode <mode>',
      'how headless steps answer permission prompts (default: env)',
    )
    .option('--step-timeout <minutes>', 'kill a step that runs longer than this (default: env)')
    .option('--json', 'print the final report as JSON', false);

export const registerRunCommand = (program: Command): Command =>
  withEngineOptions(
    program
      .command('run')
      .description(
        'Run a pipeline from START to END: one headless agent per step, routed by the graph.',
      )
      .argument('<pipeline>', 'pipeline.json, its folder, or a factory id (factories/<id>)')
      .option('-p, --param <name=value>', 'a param; repeat for several', collectParam, {})
      .option('--slug <slug>', 'pin {{slug}} instead of deriving it from the main param'),
  ).action(async (reference: string, options: RunOptions): Promise<void> => {
    const container: Container = containerFor(options);
    const pipeline: ResolvedPipeline = await container.loadPipeline({
      pipeline: reference,
      rootPath: options.root,
      suppliedParams: options.param,
      ...(options.slug === undefined ? {} : { slug: options.slug }),
    });
    await drive(container, container.runPipeline, pipeline, options);
  });

export const registerResumeCommand = (program: Command): Command =>
  withEngineOptions(
    program
      .command('resume')
      .description(
        'Pick a stopped run back up from its state.json: finished steps stand, the rest goes on.',
      )
      .argument('<runDir>', 'the run folder holding state.json'),
  ).action(async (runDir: string, options: EngineOptions): Promise<void> => {
    const base: BaseContainer = createBaseContainer();
    const folder = path.resolve(options.root, runDir);
    const state: RunState = await base.stateStore.load(folder);
    // The harness the run started on goes on with it, unless `--harness` says otherwise.
    const container: Container = containerFor(options, state.context.captured.harness);
    // Resolve the pipeline the way it resolved the first time: same params, same slug, same date.
    const pipeline: ResolvedPipeline = await container.loadPipeline({
      pipeline: state.pipelineFile,
      rootPath: options.root,
      suppliedParams: Object.fromEntries(
        Object.entries(state.context.params).map(
          ([name, value]: [string, Scalar]): [string, string] => [name, String(value)],
        ),
      ),
      slug: state.context.captured.slug,
      date: state.context.captured.date,
    });
    if (pipeline.outputDir !== folder) {
      throw createAppError(
        'RUN_NOT_RESUMABLE',
        'the pipeline no longer resolves to this run folder',
        [`state.json is in ${folder}`, `the pipeline resolves to ${pipeline.outputDir}`],
      );
    }
    await drive(container, container.resumePipeline, pipeline, options);
  });
