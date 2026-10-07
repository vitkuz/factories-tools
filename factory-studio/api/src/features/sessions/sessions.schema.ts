import { z } from 'zod';

export const harnessSchema = z.enum(['copilot', 'claude', 'agy', 'codex']);

/** A skill id: lowercase, dashes, and it ends in `-factory`. Whether it exists is checked later. */
export const factoryIdSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z0-9-]+-factory$/,
    'id must be a skill id ending in -factory, e.g. canonical-factory',
  );

export const startSessionPayloadSchema = z.object({
  id: factoryIdSchema,
  prompt: z.string().trim().min(1, 'prompt must not be empty').max(50_000),
  harness: harnessSchema.default('claude'),
});

/** A full session name or a factory id. Both are made of the same characters. */
export const stopSessionPayloadSchema = z.object({
  session: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/, 'session must be a session name or a factory id'),
});
