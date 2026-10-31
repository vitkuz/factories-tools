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

/** The widgets `pipeline.paramsInfo.<name>.type` may ask the start form for. */
export const paramInputTypeSchema = z.enum(['text', 'textarea', 'number', 'checkbox', 'select']);

/**
 * One `pipeline.paramsInfo.<name>` entry as written: UI metadata for the start form only (the
 * runner ignores it). An entry that does not parse is dropped, never the whole list.
 */
export const paramInfoSchema = z.object({
  description: z.string().optional(),
  type: paramInputTypeSchema.optional(),
  options: z.array(z.union([z.string(), z.number()])).optional(),
});

/** How the start form should show a param, from `paramsInfo`: the widget, and a select's choices. */
export const paramInputSchema = z.object({
  type: paramInputTypeSchema,
  /** Only on a `select`. */
  options: z.array(z.union([z.string(), z.number()])).optional(),
});

/** One declared param, as `GET /pipelines` describes it to the start form. */
export const factoryParamSchema = z.object({
  name: paramNameSchema,
  /** The JS type of the default: what the runner takes back. */
  type: z.enum(['string', 'number', 'boolean']),
  default: paramValueSchema,
  /** An empty default: the runner would have to ask, so the form asks first. */
  required: z.boolean(),
  /** The first declared param: the runner derives `{{slug}}` (the run folder) from it. */
  main: z.boolean(),
  /** `paramsInfo.<name>.description`: help text under the field. */
  description: z.string().optional(),
  /** `paramsInfo.<name>.type` (+ `options`): the widget asked for; absent, the form picks one. */
  input: paramInputSchema.optional(),
});
