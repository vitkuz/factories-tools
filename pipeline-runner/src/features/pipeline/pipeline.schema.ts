import { z } from 'zod';

/**
 * The shape of pipeline.json, mirroring pipeline.schema.json beside every pipeline. Shape only:
 * what a schema cannot say (names resolve, the graph is connected) lives in check-graph.service.
 */

const KEBAB: RegExp = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const IDENTIFIER: RegExp = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const EVENT: RegExp = /^[A-Z][A-Z0-9_]*$/;

export const END = 'END';

const stepNameSchema = z.string().regex(KEBAB, 'must be kebab-case and start with a letter');
const targetSchema = z.union([z.literal(END), stepNameSchema]);

export const scalarSchema = z.union([z.string(), z.number(), z.boolean()]);

export const modelSchema = z.enum(['fable', 'opus', 'sonnet', 'haiku']);

export const edgeSchema = z
  .strictObject({
    target: z.array(targetSchema).min(1),
    max: z.number().int().min(1).optional(),
    onMax: z.array(targetSchema).min(1).optional(),
    condition: z.string().min(1).optional(),
  })
  .refine((edge): boolean => edge.onMax === undefined || edge.max !== undefined, {
    message: '"onMax" also requires "max"',
  });

export const stepSchema = z.strictObject({
  agent: z.string().min(1),
  model: modelSchema.optional(),
  /** Lines of text, joined with a newline when the step is resolved. */
  prompt: z
    .array(z.string())
    .min(1)
    .refine((lines: string[]): boolean => lines.join('').trim() !== '', {
      message: 'needs some text',
    }),
  system: z.array(z.string()).optional(),
  input: z.array(z.string()).default([]),
  output: z.array(z.string()).default([]),
  knowledge: z.array(z.string()).default([]),
  workDir: z.string().optional(),
  transitions: z
    .record(z.string().regex(EVENT, 'an event is UPPER_SNAKE_CASE'), edgeSchema)
    .refine((transitions): boolean => Object.keys(transitions).length > 0, {
      message: 'needs at least one edge',
    }),
});

export const constantsSchema = z
  .object({
    rootPath: z.literal('cwd'),
    skillPath: z.literal('.'),
    homePath: z.literal('~'),
  })
  .catchall(scalarSchema);

export const hooksSchema = z.strictObject({
  before: z.array(z.string().min(1)).default([]),
  after: z.array(z.string().min(1)).default([]),
});

export const pipelineSchema = z.strictObject({
  $schema: z.string().optional(),
  id: z.string().regex(KEBAB, 'must be kebab-case'),
  name: z.string().min(1).optional(),
  author: z.string().min(1).optional(),
  description: z.string().optional(),
  constants: constantsSchema,
  params: z.record(z.string().regex(IDENTIFIER), scalarSchema).default({}),
  hooks: hooksSchema.default({ before: [], after: [] }),
  outputDir: z.string().min(1),
  START: z.array(stepNameSchema).min(1),
  steps: z
    .record(stepNameSchema, stepSchema)
    .refine((steps): boolean => Object.keys(steps).length > 0, {
      message: 'needs at least one step',
    }),
});
