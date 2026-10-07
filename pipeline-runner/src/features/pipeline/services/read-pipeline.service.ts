import type { z } from 'zod';
import type { FileSystemAdapter } from '../../../adapters/file-system/index.js';
import { createAppError, errorMessage } from '../../../shared/utils/error.utils.js';
import { pipelineSchema } from '../pipeline.schema.js';
import type { LoadedPipeline } from '../pipeline.types.js';

const parseJson = (file: string, text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw createAppError('PIPELINE_INVALID', `${file} is not valid JSON`, [errorMessage(error)]);
  }
};

const issueLine = (issue: z.core.$ZodIssue): string =>
  `$${issue.path.map((part: PropertyKey): string => `.${String(part)}`).join('')}: ${issue.message}`;

/** Text in, a typed definition out. The only judgement made here is the file's shape. */
export const parsePipeline = (file: string, text: string): LoadedPipeline => {
  const parsed = pipelineSchema.safeParse(parseJson(file, text));
  if (!parsed.success) {
    throw createAppError(
      'PIPELINE_INVALID',
      `${file} does not match the pipeline schema`,
      parsed.error.issues.map(issueLine),
    );
  }
  return { file, definition: parsed.data, warnings: [] };
};

export const readPipelineFactory =
  (fileSystem: FileSystemAdapter) =>
  async (file: string): Promise<LoadedPipeline> =>
    parsePipeline(file, await fileSystem.readText(file));
