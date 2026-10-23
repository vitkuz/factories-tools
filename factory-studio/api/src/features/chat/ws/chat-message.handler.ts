import type { ZodSafeParseResult } from 'zod';
import type { AppLogger } from '../../../shared/types.js';
import type { WsClient } from '../../../shared/ws/ws.types.js';
import { chatClientMessageSchema } from '../chat.schema.js';
import type { ChatClientMessage, ChatHub } from '../chat.types.js';

export interface ChatMessageSettings {
  hub: Pick<ChatHub, 'subscribe' | 'unsubscribe'>;
  logger?: AppLogger;
}

/** The frame's `type`, when it is a JSON object that has one. */
const typeOf = (raw: string): string | null => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && 'type' in value
      ? String((value as { type: unknown }).type)
      : null;
  } catch {
    return null;
  }
};

export const isChatFrame = (raw: string): boolean =>
  (typeOf(raw) ?? '').startsWith('session.chat.');

/**
 * `session.chat.subscribe` / `session.chat.unsubscribe`. The answer to a subscribe is not a
 * reply but the frames the hub sends the client: a backlog, then items as they are written.
 */
export const handleChatMessageFactory =
  ({ hub, logger }: ChatMessageSettings) =>
  async (raw: string, client: WsClient): Promise<unknown> => {
    let message: ZodSafeParseResult<ChatClientMessage>;
    try {
      message = chatClientMessageSchema.safeParse(JSON.parse(raw));
    } catch {
      message = chatClientMessageSchema.safeParse(undefined);
    }
    if (!message.success) {
      logger?.warn('ws: bad chat frame', { issues: message.error.issues.length });
      return { type: 'error', message: 'invalid message' };
    }
    if (message.data.type === 'session.chat.subscribe') {
      await hub.subscribe(message.data.sessionId, client);
    } else {
      hub.unsubscribe(message.data.sessionId, client.id);
    }
    return null;
  };
