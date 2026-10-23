import { z } from 'zod';

/*
 * Claude Code's session transcript, `~/.claude/projects/<project>/<session-id>.jsonl`. The
 * format is internal to Claude Code and changes between versions, so every schema here is
 * loose: a record is read for the few fields the chat needs, and a record of a type it does
 * not know is skipped, never an error.
 */

/** One content block of a message: text, thinking, tool_use, tool_result, image… */
export const contentBlockSchema = z.looseObject({
  type: z.string(),
  text: z.string().optional(),
  thinking: z.string().optional(),
  id: z.string().optional(),
  name: z.string().optional(),
  input: z.unknown().optional(),
  tool_use_id: z.string().optional(),
  content: z.unknown().optional(),
  is_error: z.boolean().optional(),
});

export const transcriptMessageSchema = z.looseObject({
  role: z.string().optional(),
  content: z.union([z.string(), z.array(z.unknown())]).optional(),
});

/** Every line of a transcript; `type` names the record (user, assistant, system, attachment…). */
export const transcriptRecordSchema = z.looseObject({
  type: z.string(),
  uuid: z.string().optional(),
  timestamp: z.string().optional(),
  isSidechain: z.boolean().optional(),
  isMeta: z.boolean().optional(),
  isCompactSummary: z.boolean().optional(),
  agentId: z.string().optional(),
  subtype: z.string().optional(),
  content: z.unknown().optional(),
  durationMs: z.number().optional(),
  thinkingDurationMs: z.number().optional(),
  message: transcriptMessageSchema.optional(),
  origin: z.looseObject({ kind: z.string().optional() }).optional(),
});

/** `<session-id>/subagents/agent-<id>.meta.json`: which tool call started the subagent. */
export const subagentMetaSchema = z.looseObject({
  agentType: z.string().optional(),
  description: z.string().optional(),
  toolUseId: z.string().optional(),
  model: z.string().optional(),
});

/* ---------------------------------------------------------------- chat model */

export const chatItemKindSchema = z.enum([
  'user',
  'assistant',
  'thinking',
  'tool_call',
  'tool_result',
  'system',
  'subagent',
]);

/** One row of the chat, compact: long text is cut and `ref` says where the whole of it is. */
export const chatItemSchema = z.object({
  id: z.string(),
  kind: chatItemKindSchema,
  text: z.string(),
  ts: z.string(),
  /** tool_call / tool_result / subagent: the tool name (or the subagent's type). */
  tool: z.string().optional(),
  toolUseId: z.string().optional(),
  /** tool_call: the input as pretty JSON. */
  input: z.string().optional(),
  /** tool_result: what the tool returned, as text. */
  output: z.string().optional(),
  isError: z.boolean().optional(),
  /** thinking: how long it took. */
  durationMs: z.number().optional(),
  /** Set on everything a subagent did, and on its `subagent` row. */
  agentId: z.string().optional(),
  /** The Agent/Task tool call that started the subagent this item belongs to. */
  parentToolUseId: z.string().optional(),
  /** Something was cut: `GET .../chat/items/<id>?ref=<ref>` answers the whole item. */
  ref: z.string().optional(),
});

/* ---------------------------------------------------------------- hook + HTTP */

/** What `hooks/studio-question-hook.mjs` posts on SessionStart: where the transcript is. */
export const sessionStartPayloadSchema = z.object({
  sessionId: z.string().min(1),
  claudeSessionId: z.string().min(1),
  transcriptPath: z.string().min(1),
  source: z.string().optional(),
});

/** `<PROMPT_DIR>/<session>.transcript.json`: the last transcript a studio session reported. */
export const transcriptLinkSchema = z.object({
  claudeSessionId: z.string().min(1),
  transcriptPath: z.string().min(1),
  at: z.string(),
});

export const chatHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(5000).default(1000),
});

export const chatItemQuerySchema = z.object({
  ref: z.string().regex(/^[A-Za-z0-9_-]+:\d+:\d+$/, 'ref must be <source>:<start>:<end>'),
});

/* ---------------------------------------------------------------- WebSocket */

export const chatClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session.chat.subscribe'), sessionId: z.string().min(1) }),
  z.object({ type: z.literal('session.chat.unsubscribe'), sessionId: z.string().min(1) }),
]);

export const chatUnavailableReasonSchema = z.enum(['unknown-session', 'no-transcript']);

export const chatServerMessageSchema = z.discriminatedUnion('type', [
  /** The answer to a subscribe: the latest items (`dropped` older ones were left out). */
  z.object({
    type: z.literal('session.chat.backlog'),
    sessionId: z.string(),
    claudeSessionId: z.string(),
    items: z.array(chatItemSchema),
    dropped: z.number().int(),
  }),
  /** New items since the backlog, in transcript order. */
  z.object({
    type: z.literal('session.chat.items'),
    sessionId: z.string(),
    items: z.array(chatItemSchema),
  }),
  /** Nothing to show yet; the subscription stays and a backlog follows when there is. */
  z.object({
    type: z.literal('session.chat.unavailable'),
    sessionId: z.string(),
    reason: chatUnavailableReasonSchema,
  }),
  /** The session is gone; the subscription is over. */
  z.object({ type: z.literal('session.chat.ended'), sessionId: z.string() }),
]);
