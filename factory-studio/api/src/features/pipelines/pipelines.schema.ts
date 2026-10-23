import { z } from 'zod';

/** What a listing needs from a `pipeline.json` on disk: an id and some steps. */
export const discoveredPipelineSchema = z.looseObject({
  id: z.string(),
  steps: z.record(z.string(), z.unknown()),
});

/** A param name, as `factories/pipeline.schema.json` allows it. */
export const paramNameSchema = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/);

/** A param's default or value: the runner takes text, numbers and booleans. */
export const paramValueSchema = z.union([z.string(), z.number(), z.boolean()]);

/** One declared param, as `GET /pipelines` describes it to the start form. */
export const factoryParamSchema = z.object({
  name: paramNameSchema,
  type: z.enum(['string', 'number', 'boolean']),
  default: paramValueSchema,
  /** An empty default: the runner would have to ask, so the form asks first. */
  required: z.boolean(),
  /** The first declared param: the runner derives `{{slug}}` (the run folder) from it. */
  main: z.boolean(),
});
