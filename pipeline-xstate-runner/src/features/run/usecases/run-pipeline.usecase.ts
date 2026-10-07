import path from 'node:path';
import type { HarnessClient } from '../../../clients/harness/harness.types.js';
import type { Result } from '../../../shared/types/result.types.js';
import { ok, refuse } from '../../../shared/utils/result.utils.js';
import type { RunInput } from '../../machines/machines.types.js';
import { locatePipelineFactory } from '../../pipeline/services/locate-pipeline.service.js';
import { createRunEffects } from '../services/create-run-effects.service.js';
import { driveRunFactory } from '../services/drive-run.service.js';
import { outcomeOf } from '../services/outcome-of.service.js';
import type { RunDeps, RunOutcome, RunRequest } from '../run.types.js';

export const HARNESS_CHECK = {
  id: 'harness-installed',
  description: 'The harness named by --harness (or the run being resumed) is installed.',
} as const;

/** The harness a run uses, by name; an unknown name is refused before anything starts. */
export const harnessOf =
  (deps: RunDeps) =>
  (name: string): Result<HarnessClient> => {
    const harness: HarnessClient | undefined = deps.harnesses[name];
    return harness === undefined
      ? refuse(HARNESS_CHECK.id)(
          `no harness "${name}": installed are ${Object.keys(deps.harnesses).sort().join(', ')}`,
        )
      : ok(harness);
  };

/** The `$schema` a new state.json points at: the kit's, relative to the project root. */
export const schemaRefFor = (): string => path.join('factories', 'state.schema.json');

/**
 * run = locate the pipeline → pick the harness → start the run machine from its input and drive
 * it to rest. Validation, resolution, hooks, steps and the after hooks are the machine's states.
 */
export const runPipelineFactory =
  (deps: RunDeps) =>
  async (request: RunRequest): Promise<RunOutcome> => {
    const located = locatePipelineFactory(deps.fileSystem)(deps.rootPath, deps.cwd)(
      request.pipelineRef,
    );
    if (!located.ok) return { kind: 'refused', ...located.refusal };
    const harness = harnessOf(deps)(request.options.harness);
    if (!harness.ok) return { kind: 'refused', ...harness.refusal };

    const input: RunInput = {
      pipelineFile: located.value,
      rootPath: deps.rootPath,
      cwd: deps.cwd,
      homePath: deps.homePath,
      params: request.params,
      runHex: deps.newHex(),
      schemaRef: schemaRefFor(),
      options: request.options,
    };
    const snapshot = await driveRunFactory(deps)({
      effects: createRunEffects(deps)(harness.value),
      start: { input },
    });
    return outcomeOf(snapshot);
  };
