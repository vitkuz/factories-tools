import type { Result } from '../../../shared/types/result.types.js';
import { map } from '../../../shared/utils/result.utils.js';
import { locatePipelineFactory } from '../../pipeline/services/locate-pipeline.service.js';
import { validatePipelineFactory } from '../../pipeline/services/validate-pipeline.service.js';
import type { ValidationReport } from '../../pipeline/services/validate-pipeline.service.js';
import type { RunDeps } from '../run.types.js';

/** validate = locate → the shape → the graph rules. The same verdict as the kit's validate.mjs. */
export const validatePipelineUsecaseFactory =
  (deps: Pick<RunDeps, 'fileSystem' | 'rootPath' | 'cwd' | 'homePath'>) =>
  (pipelineRef: string | undefined): Result<ValidationReport> =>
    map(
      validatePipelineFactory(deps.fileSystem)({
        rootPath: deps.rootPath,
        cwd: deps.cwd,
        homePath: deps.homePath,
      }),
    )(locatePipelineFactory(deps.fileSystem)(deps.rootPath, deps.cwd)(pipelineRef));
