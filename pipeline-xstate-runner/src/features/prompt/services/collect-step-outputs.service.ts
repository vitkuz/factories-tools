// Learned from factories-tools/pipeline-runner/src/features/run/services/execute-agent-step.service.ts (collectOutputsFactory)
import path from 'node:path';
import type { FileSystemClient } from '../../../clients/file-system/types.js';
import type { ResolvedStep } from '../../pipeline/pipeline.types.js';
import { expandFilesFactory } from './collect-step-materials.service.js';

/** The files a step really produced, relative to the run folder — a pattern is never recorded. */
export const collectStepOutputsFactory =
  (fileSystem: FileSystemClient) =>
  (runDir: string) =>
  (step: ResolvedStep): string[] =>
    step.output
      .flatMap(expandFilesFactory(fileSystem))
      .map((file: string): string => path.relative(runDir, file).split(path.sep).join('/'));
