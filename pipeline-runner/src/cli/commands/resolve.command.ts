import type { Command } from 'commander';
import { buildStepPrompt, collectStepMaterialsFactory } from '../../features/run/index.js';
import { harnessSchema, type Harness } from '../../features/harness/index.js';
import type { ResolvedPipeline, ResolvedStep } from '../../features/pipeline/index.js';
import { createAppError } from '../../shared/utils/error.utils.js';
import { collectParam } from '../cli.utils.js';
import { createContainer, type Container } from '../composition-root.js';

interface ResolveOptions {
  param: Record<string, string>;
  root: string;
  slug?: string;
  prompt?: string;
  harness?: string;
}

/** The exact task message a step's agent would get on its first pass, given the disk as it is. */
const firstPassPrompt = async (
  container: Container,
  pipeline: ResolvedPipeline,
  name: string,
): Promise<string> => {
  const step: ResolvedStep | undefined = pipeline.steps[name];
  if (step === undefined)
    throw createAppError(
      'PIPELINE_INVALID',
      `no step named "${name}"`,
      Object.keys(pipeline.steps),
    );
  return buildStepPrompt(step, await collectStepMaterialsFactory(container.fileSystem)(step), {
    pass: 1,
    feedbackFiles: [],
  });
};

export const registerResolveCommand = (program: Command): Command =>
  program
    .command('resolve')
    .description('Load a pipeline and print it fully resolved. Spawns nothing, creates nothing.')
    .argument('<pipeline>', 'pipeline.json, its folder, or a factory id (factories/<id>)')
    .option('-p, --param <name=value>', 'a param; repeat for several', collectParam, {})
    .option('--root <dir>', 'the repository root', process.cwd())
    .option('--slug <slug>', 'pin {{slug}} instead of deriving it from the main param')
    .option('--prompt <step>', "print that step's assembled task message instead of the JSON")
    .option('--harness <name>', 'whose custom agents the load-time check looks for (default: env)')
    .action(async (reference: string, options: ResolveOptions): Promise<void> => {
      const harness = harnessSchema.safeParse(options.harness);
      if (options.harness !== undefined && !harness.success)
        throw createAppError('HARNESS_INVALID', `--harness does not take "${options.harness}"`, [
          `one of: ${harnessSchema.options.join(', ')}`,
        ]);
      const chosen: Harness | undefined = harness.success ? harness.data : undefined;
      const container: Container = createContainer(chosen === undefined ? {} : { harness: chosen });
      const pipeline: ResolvedPipeline = await container.loadPipeline({
        pipeline: reference,
        rootPath: options.root,
        suppliedParams: options.param,
        ...(options.slug === undefined ? {} : { slug: options.slug }),
      });
      pipeline.warnings.forEach((warning: string): void => container.logger.warn(warning));
      process.stdout.write(
        options.prompt === undefined
          ? `${JSON.stringify(pipeline, null, 2)}\n`
          : `${await firstPassPrompt(container, pipeline, options.prompt)}\n`,
      );
    });
