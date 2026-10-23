import { z } from 'zod';
import { sessionRunLinkSchema } from '../runs/runs.schema.js';
import { sessionStatusSchema } from '../sessions/sessions.schema.js';

export const questionOptionSchema = z.object({
  label: z.string(),
  description: z.string().default(''),
});

export const questionSchema = z.object({
  header: z.string().default(''),
  question: z.string().min(1),
  multiSelect: z.boolean().default(false),
  options: z.array(questionOptionSchema).default([]),
});

export const pendingQuestionSchema = z.object({
  sessionId: z.string().min(1),
  promptId: z.string().min(1),
  toolUseId: z.string(),
  questions: z.array(questionSchema),
  askedAt: z.string(),
  /** The run the asking session is running, when it can be told; the run page shows the box. */
  run: sessionRunLinkSchema.optional(),
});

/** One answer per question: option labels, and/or the text typed under "Type something". */
export const answerSchema = z
  .object({
    question: z.string().min(1),
    selected: z.array(z.string()).default([]),
    text: z.string().optional(),
  })
  .refine((answer): boolean => answer.selected.length > 0 || (answer.text ?? '').trim() !== '', {
    message: 'an answer needs a selected option or text',
  });

/** What `hooks/studio-question-hook.mjs` posts for a PreToolUse on AskUserQuestion. */
export const askUserQuestionPayloadSchema = z.object({
  sessionId: z.string().min(1),
  claudeSessionId: z.string().optional(),
  transcriptPath: z.string().optional(),
  toolUseId: z.string().default(''),
  toolInput: z.looseObject({ questions: z.array(questionSchema).min(1) }),
});

/** What the hook posts for a PostToolUse on AskUserQuestion: the question is over. */
export const questionResolvedPayloadSchema = z.object({
  sessionId: z.string().min(1),
  toolUseId: z.string().default(''),
  answers: z.record(z.string(), z.string()).optional(),
});

export const answerQuestionPayloadSchema = z.object({
  sessionId: z.string().min(1),
  promptId: z.string().min(1),
  answers: z.array(answerSchema).min(1),
});

export const dismissQuestionPayloadSchema = z.object({
  sessionId: z.string().min(1),
  promptId: z.string().min(1),
});

export const resolveReasonSchema = z.enum(['answered', 'dismissed', 'timeout', 'terminal']);

/** The WebSocket protocol, server -> client. */
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

/** The WebSocket protocol, client -> server. */
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session.answer'), ...answerQuestionPayloadSchema.shape }),
  z.object({ type: z.literal('session.dismiss'), ...dismissQuestionPayloadSchema.shape }),
  z.object({
    type: z.literal('session.reply'),
    sessionId: z.string().min(1),
    text: z.string().min(1).max(10_000),
  }),
]);
