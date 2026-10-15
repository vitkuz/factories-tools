import { z } from 'zod';

/** A skill directory name: lowercase words joined by single dashes. */
export const pipelineIdParamSchema = z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);

export const pipelineEdgeSchema = z.looseObject({
  target: z.array(z.string()).min(1),
  max: z.number().int().min(1).optional(),
  onMax: z.array(z.string()).min(1).optional(),
  condition: z.string().min(1).optional(),
});

export const pipelineStepSchema = z.looseObject({
  agent: z.string().min(1),
  system: z.array(z.string()).min(1).optional(),
  prompt: z.array(z.string()).min(1),
  transitions: z.record(z.string(), pipelineEdgeSchema),
});

/**
 * What a save must at least carry. Every unknown key at every level (`hooks`, `params`,
 * `$schema`, a step's `knowledge`...) passes through untouched: the file on disk is the body
 * as received, not this schema's output.
 */
export const pipelineFileSchema = z.looseObject({
  id: pipelineIdParamSchema,
  constants: z.looseObject({ rootPath: z.string() }),
  outputDir: z.string().min(1),
  START: z.array(z.string()).min(1),
  steps: z.record(z.string(), pipelineStepSchema),
});

/**
 * What a create (E4b) must carry on top of a save: the three path anchors with their fixed
 * values, and `factoryPath`, so every knowledge file of the new factory can anchor on
 * `{{factoryPath}}/knowledge/`. The wrapper skill is generated from `id` and `description`.
 */
export const newPipelineFileSchema = pipelineFileSchema.extend({
  description: z.string().min(1).optional(),
  constants: z.looseObject({
    rootPath: z.literal('cwd'),
    skillPath: z.literal('.'),
    homePath: z.literal('~'),
    factoryPath: z.string().min(1),
  }),
});

/** What a listing needs from a `pipeline.json` on disk: an id and some steps. */
export const discoveredPipelineSchema = z.looseObject({
  id: z.string(),
  steps: z.record(z.string(), z.unknown()),
});
