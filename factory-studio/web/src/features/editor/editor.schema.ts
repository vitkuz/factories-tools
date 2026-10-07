import { z } from 'zod';

/** One entry of `GET /api/v1/pipelines` (E2): the skill id, its file and the parsed file. */
export const pipelineListEntrySchema = z.object({
  id: z.string(),
  path: z.string(),
  pipeline: z.looseObject({ id: z.string(), description: z.string().optional() }),
});

export const pipelineListSchema = z.object({
  pipelines: z.array(pipelineListEntrySchema),
});

/** The answer of a create (E4b): the two files the new factory is made of. */
export const createdSchema = z.object({
  kind: z.literal('created'),
  id: z.string(),
  path: z.string(),
  skill: z.string(),
  bytes: z.number(),
});

/** The answer of every write (E4, E8). */
export const savedSchema = z.object({
  kind: z.literal('saved'),
  bytes: z.number(),
});
