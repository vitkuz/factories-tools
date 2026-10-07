import { z } from 'zod';
import { discoveredPipelineSchema } from '../pipelines/pipelines.schema.js';

/** Only the fields the API reads; every other recorder field passes through. */
export const runStateFileSchema = z.looseObject({
  pipelineName: z.string().optional(),
  pipeline: z.string().optional(),
  createdAt: z.string().optional(),
  startAt: z.string().optional(),
});

export const costFileSchema = z.looseObject({});

export const runPipelineFileSchema = discoveredPipelineSchema;
