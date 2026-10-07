import os from 'node:os';
import path from 'node:path';
import type { FileSystemAdapter } from '../../../adapters/file-system/index.js';
import type { ShellAdapter } from '../../../adapters/shell/index.js';
import { createAppError } from '../../../shared/utils/error.utils.js';
import type {
  LoadPipelineRequest,
  LoadedPipeline,
  PipelineDefinition,
  ValidationOutcome,
  Variables,
} from '../load.types.js';
import {
  locatePipelineFileFactory,
  readRawPipelineFactory,
  resolveOutputDir,
  resolveVariables,
  toDefinition,
  validatePipelineFactory,
  type RawPipeline,
} from '../services/index.js';

export interface LoadPipelineDeps {
  fileSystem: FileSystemAdapter;
  shell: ShellAdapter;
  homeDir?: () => string;
}

/**
 * load = locate → read (upgrade legacy) → type (Zod) → validate with the shared validator → resolve.
 * Fatal validator errors stop here, printed the validator's way; the rest travels as warnings.
 */
export const loadPipelineFactory =
  (deps: LoadPipelineDeps) =>
  (request: LoadPipelineRequest): LoadedPipeline => {
    const rootPath: string = path.resolve(request.rootPath);
    const file: string = locatePipelineFileFactory(deps.fileSystem)(rootPath)(request.pipeline);
    const raw: RawPipeline = readRawPipelineFactory(deps.fileSystem)(file);
    // shape first: Zod names the field at fault, where the shared validator only crashes on a non-pipeline
    const definition: PipelineDefinition = toDefinition(raw);
    const validation: ValidationOutcome = validatePipelineFactory(
      deps.fileSystem,
      deps.shell,
    )(rootPath)(file, raw.legacy);
    if (validation.fatal.length > 0) {
      throw createAppError('PIPELINE_INVALID', `${file} is not a valid pipeline`, validation.fatal);
    }
    const variables: Variables = resolveVariables({
      rootPath,
      homePath: (deps.homeDir ?? os.homedir)(),
    })(definition);
    return {
      file,
      rootPath,
      definition,
      variables,
      outputDir: resolveOutputDir(variables, definition),
      unreachable: validation.unreachable,
      warnings: validation.warnings,
    };
  };

export type LoadPipeline = ReturnType<typeof loadPipelineFactory>;
