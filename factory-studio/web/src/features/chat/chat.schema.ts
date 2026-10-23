import { z } from 'zod';

/** One row of a session's chat as the API maps Claude Code's transcript (see the API's chat.schema). */
export const chatItemSchema = z.object({
  id: z.string(),
  kind: z.enum(['user', 'assistant', 'thinking', 'tool_call', 'tool_result', 'system', 'subagent']),
  text: z.string(),
  ts: z.string(),
  tool: z.string().optional(),
  toolUseId: z.string().optional(),
  input: z.string().optional(),
  output: z.string().optional(),
  isError: z.boolean().optional(),
  durationMs: z.number().optional(),
  agentId: z.string().optional(),
  parentToolUseId: z.string().optional(),
  /** Something was cut; the whole item is one GET away. */
  ref: z.string().optional(),
});

export const chatUnavailableReasonSchema = z.enum(['unknown-session', 'no-transcript']);

/** The chat frames of the socket, server -> client. Part of the sessions protocol union. */
export const chatBacklogMessageSchema = z.object({
  type: z.literal('session.chat.backlog'),
  sessionId: z.string(),
  claudeSessionId: z.string(),
  items: z.array(chatItemSchema),
  dropped: z.number(),
});

export const chatItemsMessageSchema = z.object({
  type: z.literal('session.chat.items'),
  sessionId: z.string(),
  items: z.array(chatItemSchema),
});

export const chatUnavailableMessageSchema = z.object({
  type: z.literal('session.chat.unavailable'),
  sessionId: z.string(),
  reason: chatUnavailableReasonSchema,
});

export const chatEndedMessageSchema = z.object({
  type: z.literal('session.chat.ended'),
  sessionId: z.string(),
});

/** client -> server. */
export const chatSubscribeMessageSchema = z.object({
  type: z.literal('session.chat.subscribe'),
  sessionId: z.string().min(1),
});

export const chatUnsubscribeMessageSchema = z.object({
  type: z.literal('session.chat.unsubscribe'),
  sessionId: z.string().min(1),
});

/** `GET /sessions/:id/chat/items/:itemId?ref=`: one item, uncut. */
export const chatItemResponseSchema = z.object({ item: chatItemSchema });
