import type { PipelineServices, ReadPipelineResult } from '../pipelines.types.js';

export type ReadPipelineSettings = Pick<PipelineServices, 'readPipelineFile'>;

export const readPipelineFactory =
  ({ readPipelineFile }: ReadPipelineSettings) =>
  (id: string): Promise<ReadPipelineResult> =>
    readPipelineFile(id);
