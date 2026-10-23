import { z } from 'zod';
import { paramNameSchema } from '../pipelines/pipelines.schema.js';

export const harnessSchema = z.enum(['copilot', 'claude', 'agy', 'codex']);

/** A skill id: lowercase, dashes, and it ends in `-factory`. Whether it exists is checked later. */
export const factoryIdSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z0-9-]+-factory$/,
    'id must be a skill id ending in -factory, e.g. canonical-factory',
  );

/** One param value as the start form sends it; it is coerced to its default's type later. */
export const startParamValueSchema = z.union([z.string().max(50_000), z.number(), z.boolean()]);

/**
 * Either the factory's params (name → value) with optional extra instructions in `prompt`, or,
 * for a factory without params, one free-text `prompt`. Something must be there.
 */
export const startSessionPayloadSchema = z
  .object({
    id: factoryIdSchema,
    params: z.record(paramNameSchema, startParamValueSchema).default({}),
    prompt: z.string().trim().max(50_000).default(''),
    harness: harnessSchema.default('claude'),
  })
  .refine(
    ({ params, prompt }: { params: Record<string, unknown>; prompt: string }): boolean =>
      prompt !== '' || Object.keys(params).length > 0,
    { message: 'prompt must not be empty', path: ['prompt'] },
  );

/** A full session name or a factory id. Both are made of the same characters. */
export const stopSessionPayloadSchema = z.object({
  session: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/, 'session must be a session name or a factory id'),
});

/** What is written next to the prompt so a session can be described again after an API restart. */
export const sessionMetaSchema = z.object({
  session: z.string().min(1),
  factoryId: z.string().min(1),
  harness: harnessSchema,
  startedAt: z.string().min(1),
});

/** herdr's agent lifecycle for the pane a session runs in. */
export const sessionStatusSchema = z.enum(['idle', 'working', 'blocked', 'done', 'unknown']);

/** Plain text typed into the session's pane, then Enter. */
export const replySessionPayloadSchema = z.object({
  sessionId: z.string().trim().min(1),
  text: z.string().min(1).max(10_000),
});
