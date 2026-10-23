import { v4 as uuid } from 'uuid';
import { clientMessageSchema, serverMessageSchema } from '../../features/sessions/sessions.schema';
import type { ClientMessage, ServerMessage } from '../../features/sessions/sessions.types';
import { socketUrlFor } from '../../shared/lib/websocket.utils';
import { socketPath } from '../http/api-paths';

/** The socket of the page's own origin. No key: the app is same-origin, like the HTTP adapter. */
export const sessionsSocketUrl = (): string => socketUrlFor(window.location, socketPath());

/** A text frame to a typed server message; a frame that breaks the protocol is logged and dropped. */
export const parseServerMessage = (raw: string): ServerMessage | null => {
  const frameId: string = uuid();
  try {
    const parsed = serverMessageSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      console.warn('[ws] ✕ frame breaks the protocol', { frameId, issues: parsed.error.issues });
      return null;
    }
    console.debug('[ws] ←', { frameId, type: parsed.data.type });
    return parsed.data;
  } catch (error: unknown) {
    console.warn('[ws] ✕ frame is not JSON', { frameId, error });
    return null;
  }
};

/** A client message checked against its schema before it leaves, as the HTTP payloads are. */
export const serializeClientMessage = (message: ClientMessage): string => {
  const checked: ClientMessage = clientMessageSchema.parse(message);
  console.debug('[ws] →', { type: checked.type });
  return JSON.stringify(checked);
};
