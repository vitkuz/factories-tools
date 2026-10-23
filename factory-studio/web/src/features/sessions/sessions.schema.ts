import { z } from 'zod';

/** A param's default or value: the runner takes text, numbers and booleans. */
export const paramValueSchema = z.union([z.string(), z.number(), z.boolean()]);

/** One declared param of a factory, typed by its default (E2). */
export const factoryParamSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean']),
  default: paramValueSchema,
  /** An empty default: the runner would ask for it, so the form asks first. */
  required: z.boolean(),
  /** The first declared param: the runner names the run folder (`{{slug}}`) after it. */
  main: z.boolean(),
});

/** One entry of `GET /api/v1/pipelines` (E2): the skill id, its file, the parsed file and its params. */
export const pipelineListEntrySchema = z.object({
  id: z.string(),
  path: z.string(),
  pipeline: z.looseObject({ id: z.string(), description: z.string().optional() }),
  params: z.array(factoryParamSchema).default([]),
  description: z.string().optional(),
});

export const pipelineListSchema = z.object({
  pipelines: z.array(pipelineListEntrySchema),
});

export const harnessSchema = z.enum(['claude', 'copilot', 'agy', 'codex']);

/** What herdr reports for the agent in a session's pane. */
export const sessionStatusSchema = z.enum(['idle', 'working', 'blocked', 'done', 'unknown']);

/** One running session as E10 / E11 report it. */
export const factorySessionSchema = z.object({
  session: z.string(),
  factoryId: z.string(),
  harness: z.union([harnessSchema, z.literal('unknown')]),
  startedAt: z.string(),
  ageSeconds: z.number(),
  age: z.string(),
  status: sessionStatusSchema.optional(),
  workspaceId: z.string().optional(),
  paneId: z.string().optional(),
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

/**
 * What the app sends to E9: the API's own rules, checked before the request leaves. The params
 * as name → value, `prompt` the extra instructions; a factory without params sends `prompt` only.
 */
export const startSessionPayloadSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+-factory$/),
    params: z.record(
      z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
      z.union([z.string().max(50_000), z.number(), z.boolean()]),
    ),
    prompt: z.string().trim().max(50_000),
    harness: harnessSchema,
  })
  .refine(
    ({ params, prompt }: { params: Record<string, unknown>; prompt: string }): boolean =>
      prompt !== '' || Object.keys(params).length > 0,
    { message: 'prompt must not be empty', path: ['prompt'] },
  );

export const stopSessionPayloadSchema = z.object({
  session: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/),
});

/* ---------------------------------------------------------------- WebSocket protocol */

export const questionOptionSchema = z.object({
  label: z.string(),
  description: z.string(),
});

export const questionSchema = z.object({
  header: z.string(),
  question: z.string(),
  multiSelect: z.boolean(),
  options: z.array(questionOptionSchema),
});

/** A question Claude asked through AskUserQuestion, held by the API until a person answers. */
/** The run a question's session is in, as the API told it (see the API's `findSessionRun`). */
export const sessionRunLinkSchema = z.object({
  pipelineId: z.string(),
  runId: z.string(),
  match: z.enum(['session', 'started-after']),
});

export const pendingQuestionSchema = z.object({
  sessionId: z.string(),
  promptId: z.string(),
  toolUseId: z.string(),
  questions: z.array(questionSchema),
  askedAt: z.string(),
  /** Missing when the API could not tell the run: the question then shows on Sessions only. */
  run: sessionRunLinkSchema.optional(),
});

/** One answer: the labels picked, and/or the free text from "Type something". */
export const answerSchema = z.object({
  question: z.string(),
  selected: z.array(z.string()),
  text: z.string().optional(),
});

export const resolveReasonSchema = z.enum(['answered', 'dismissed', 'timeout', 'terminal']);

export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), pending: z.array(pendingQuestionSchema) }),
  z.object({ type: z.literal('session.question'), question: pendingQuestionSchema }),
  z.object({
    type: z.literal('session.question.resolved'),
    sessionId: z.string(),
    promptId: z.string(),
    reason: resolveReasonSchema,
  }),
  z.object({
    type: z.literal('session.status'),
    sessionId: z.string(),
    status: sessionStatusSchema,
  }),
  z.object({ type: z.literal('error'), message: z.string(), ref: z.string().optional() }),
]);

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session.answer'),
    sessionId: z.string(),
    promptId: z.string(),
    answers: z.array(answerSchema),
  }),
  z.object({ type: z.literal('session.dismiss'), sessionId: z.string(), promptId: z.string() }),
  z.object({ type: z.literal('session.reply'), sessionId: z.string(), text: z.string().min(1) }),
]);
