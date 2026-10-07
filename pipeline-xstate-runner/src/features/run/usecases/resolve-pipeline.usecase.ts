import path from 'node:path';
import { dayOf } from '../../../clients/clock/clock.utils.js';
import type { Result } from '../../../shared/types/result.types.js';
import { chain, ok, refuse } from '../../../shared/utils/result.utils.js';
import type { Pipeline, ResolvedPipeline, ResolvedStep } from '../../pipeline/pipeline.types.js';
import { loadPipelineFactory } from '../../pipeline/services/load-pipeline.service.js';
import { locatePipelineFactory } from '../../pipeline/services/locate-pipeline.service.js';
import { resolvePipeline } from '../../pipeline/services/resolve-pipeline.service.js';
import { buildStepPrompt } from '../../prompt/services/build-step-prompt.service.js';
import { collectStepMaterialsFactory } from '../../prompt/services/collect-step-materials.service.js';
import type { RunDeps } from '../run.types.js';

export interface ResolveRequest {
  pipelineRef: string | undefined;
  params: Record<string, string>;
  /** Print this step's first-pass task message instead of the resolved pipeline. */
  prompt?: string;
}

export type Resolved =
  { kind: 'pipeline'; pipeline: ResolvedPipeline } | { kind: 'prompt'; text: string };

/** resolve = locate → load → params, variables, paths, today's date. Spawns nothing, writes nothing. */
export const resolvePipelineUsecaseFactory =
  (deps: Pick<RunDeps, 'fileSystem' | 'rootPath' | 'cwd' | 'homePath' | 'clock'>) =>
  (request: ResolveRequest): Result<Resolved> =>
    chain((file: string): Result<Resolved> =>
      chain((pipeline: Pipeline): Result<Resolved> =>
        chain((resolved: ResolvedPipeline): Result<Resolved> => {
          if (request.prompt === undefined) return ok({ kind: 'pipeline', pipeline: resolved });
          const step: ResolvedStep | undefined = resolved.steps[request.prompt];
          if (step === undefined) {
            return refuse('step-is-known')(
              `no step "${request.prompt}": one of ${Object.keys(resolved.steps).join(', ')}`,
            );
          }
          const materials = collectStepMaterialsFactory(deps.fileSystem)(resolved.anchors)(step);
          return ok({
            kind: 'prompt',
            text: buildStepPrompt(step, materials, { pass: 1, feedbackFiles: [] }),
          });
        })(
          resolvePipeline({
            anchors: {
              rootPath: deps.rootPath,
              skillPath: path.join(deps.rootPath, '.claude', 'skills', pipeline.id),
              homePath: deps.homePath,
            },
            date: dayOf(deps.clock.now()),
            suppliedParams: request.params,
          })(file, pipeline),
        ),
      )(loadPipelineFactory(deps.fileSystem)(file)),
    )(locatePipelineFactory(deps.fileSystem)(deps.rootPath, deps.cwd)(request.pipelineRef));
