import { z } from 'zod';

export const harnessSchema = z.enum(['claude', 'copilot', 'agy', 'codex']);

/** One running tmux session as E10 / E11 report it. */
export const factorySessionSchema = z.object({
  session: z.string(),
  factoryId: z.string(),
  harness: z.union([harnessSchema, z.literal('unknown')]),
  startedAt: z.string(),
  ageSeconds: z.number(),
  age: z.string(),
});

export const sessionListSchema = z.object({
  count: z.number(),
  sessions: z.array(factorySessionSchema),
});

/** The `201` body of E9. */
export const startedSessionSchema = z.object({
  session: z.string(),
  factoryId: z.string(),
  harness: harnessSchema,
  prompt: z.string(),
  promptFile: z.string(),
  workDir: z.string(),
});

export const stoppedSchema = z.object({
  stopped: factorySessionSchema,
});

/** What the app sends to E9: the API's own rules, checked before the request leaves. */
export const startSessionPayloadSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+-factory$/),
  prompt: z.string().trim().min(1).max(50_000),
  harness: harnessSchema,
});

export const stopSessionPayloadSchema = z.object({
  session: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/),
});
