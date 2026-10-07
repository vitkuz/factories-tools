import type { z } from 'zod';
import type { FileSystemAdapter } from '../../../adapters/file-system/index.js';
import { createAppError, errorMessage } from '../../../shared/utils/error.utils.js';
import { pipelineSchema } from '../pipeline.schema.js';
import type { PipelineDefinition } from '../load.types.js';
import { isLegacyPipeline, upgradeLegacyPipeline } from '../load.utils.js';

/** The file as JSON, and whether its prompts were in the older string shape. */
export interface RawPipeline {
  file: string;
  document: unknown;
  legacy: boolean;
}

const parseJson = (file: string, text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw createAppError('PIPELINE_INVALID', `${file} is not valid JSON`, [errorMessage(error)]);
  }
};

const issueLine = (issue: z.core.$ZodIssue): string =>
  `$${issue.path.map((part: PropertyKey): string => `.${String(part)}`).join('')}: ${issue.message}`;

/** Text in, the raw document out — upgraded to the current prompt shape the way the Studio does on read. */
export const parseRawPipeline = (file: string, text: string): RawPipeline => {
  const document: unknown = parseJson(file, text);
  return { file, document: upgradeLegacyPipeline(document), legacy: isLegacyPipeline(document) };
};

/** The raw document as a typed definition. Only the file's shape is judged here. */
export const toDefinition = (raw: RawPipeline): PipelineDefinition => {
  const parsed = pipelineSchema.safeParse(raw.document);
  if (!parsed.success) {
    throw createAppError(
      'PIPELINE_INVALID',
      `${raw.file} does not match the pipeline schema`,
      parsed.error.issues.map(issueLine),
    );
  }
  return parsed.data;
};

export const readRawPipelineFactory =
  (fileSystem: FileSystemAdapter) =>
  (file: string): RawPipeline =>
    parseRawPipeline(file, fileSystem.readText(file));
