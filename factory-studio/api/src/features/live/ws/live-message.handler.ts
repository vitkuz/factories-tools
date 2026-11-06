import type { ZodSafeParseResult } from 'zod';
import type { AppLogger } from '../../../shared/types.js';
import type { WsClient } from '../../../shared/ws/ws.types.js';
import { liveClientMessageSchema } from '../live.schema.js';
import type { LiveClientMessage, SendSnapshot, SubscriptionRegistry } from '../live.types.js';

export interface LiveMessageSettings {
  registry: Pick<SubscriptionRegistry, 'subscribe' | 'unsubscribe'>;
  sendSnapshot: SendSnapshot;
  logger?: AppLogger;
}

const parse = (raw: string): ZodSafeParseResult<LiveClientMessage> => {
  try {
    return liveClientMessageSchema.safeParse(JSON.parse(raw));
  } catch {
    return liveClientMessageSchema.safeParse(undefined);
  }
};

/**
 * `live.subscribe` registers the client for each topic and answers with that topic's snapshot
 * (a second subscribe to the same topic sends the snapshot again: that is how a screen resyncs).
 * `live.unsubscribe` is silent. A frame that breaks the schema answers one `error`.
 */
export const handleLiveMessageFactory =
  ({ registry, sendSnapshot, logger }: LiveMessageSettings) =>
  async (raw: string, client: WsClient): Promise<unknown> => {
    const parsed: ZodSafeParseResult<LiveClientMessage> = parse(raw);
    if (!parsed.success) {
      logger?.warn('ws: bad live frame', { issues: parsed.error.issues.length });
      return { type: 'error', message: 'invalid message' };
    }
    const message: LiveClientMessage = parsed.data;
    if (message.type === 'live.unsubscribe') {
      registry.unsubscribe(client.id, message.topics);
      return null;
    }
    registry.subscribe(client, message.topics);
    for (const topic of message.topics) await sendSnapshot(topic, client);
    return null;
  };
