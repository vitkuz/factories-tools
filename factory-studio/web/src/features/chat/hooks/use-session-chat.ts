import { useCallback, useEffect, useReducer, useState } from 'react';
import { v4 as uuid } from 'uuid';
import { describeApiError, isApiError } from '../../../adapters/http/api-error.utils';
import { readChatItem, sendSessionMessage } from '../../../adapters/http/studio-api.adapter';
import type { SocketState } from '../../../shared/lib/use-websocket';
import { useQuestions } from '../../sessions/hooks/use-questions';
import type { SessionQuestions } from '../../sessions/hooks/use-session-questions';
import type { ServerMessage } from '../../sessions/sessions.types';
import type { ChatAction, ChatItem, ChatState, SendState, SentMessage } from '../chat.types';
import { initialChatState, pendingItem, reduceChat } from '../chat.utils';

export interface SessionChat {
  state: ChatState;
  connection: SocketState;
  /** Fetches the whole of a cut item and puts it in place. */
  expand: (item: ChatItem) => Promise<void>;
  send: SendState;
  /** Sends a message to the session; `true` when the API took it. */
  sendMessage: (text: string) => Promise<boolean>;
  clearSendError: () => void;
}

const NOT_STARTED =
  'Sent, but Claude was not seen starting a turn. Look at the session in the terminal.';

const idleSend: SendState = { sending: false, error: null, notice: null };

/** A frame about this session's chat, as a reducer action; anything else is `null`. */
const toAction = (sessionId: string, message: ServerMessage): ChatAction | null => {
  if (!('sessionId' in message) || message.sessionId !== sessionId) return null;
  switch (message.type) {
    case 'session.chat.backlog':
      return { kind: 'backlog', items: message.items, dropped: message.dropped };
    case 'session.chat.items':
      return { kind: 'items', items: message.items };
    case 'session.chat.unavailable':
      return { kind: 'unavailable', reason: message.reason };
    case 'session.chat.ended':
      return { kind: 'ended' };
    default:
      return null;
  }
};

/** The API's refusal as one line under the box. */
const sendFailure = (error: unknown): string => {
  if (!isApiError(error)) return error instanceof Error ? error.message : String(error);
  if (error.kind === 'http' && error.status === 404) return 'The session is gone.';
  return describeApiError(error);
};

/**
 * One session's live chat over the app's one socket: subscribes on mount and again after every
 * reconnect (the backlog then replaces what is held), unsubscribes on unmount. A message sent
 * from the box shows at once as a pending bubble; the transcript's own copy takes its place.
 */
export const useSessionChat = (sessionId: string): SessionChat => {
  const questions: SessionQuestions = useQuestions();
  const { channel, connection } = questions;
  const [state, dispatch] = useReducer<ChatState, [ChatAction]>(reduceChat, initialChatState);
  const [send, setSend] = useState<SendState>(idleSend);

  useEffect(
    (): (() => void) =>
      channel.listen((message: ServerMessage): void => {
        const action: ChatAction | null = toAction(sessionId, message);
        if (action !== null) dispatch(action);
      }),
    [channel, sessionId],
  );

  useEffect((): (() => void) | void => {
    if (connection !== 'open') {
      dispatch({ kind: 'reconnecting' });
      return;
    }
    channel.send({ type: 'session.chat.subscribe', sessionId });
    return (): void => {
      channel.send({ type: 'session.chat.unsubscribe', sessionId });
    };
  }, [channel, connection, sessionId]);

  const expand = useCallback(
    async (item: ChatItem): Promise<void> => {
      if (!item.ref) return;
      try {
        dispatch({ kind: 'expanded', item: await readChatItem(sessionId, item.id, item.ref) });
      } catch (error: unknown) {
        console.error('[chat] show more', isApiError(error) ? describeApiError(error) : error);
      }
    },
    [sessionId],
  );

  const sendMessage = useCallback(
    async (text: string): Promise<boolean> => {
      if (send.sending) return false;
      const item: ChatItem = pendingItem(uuid(), text, new Date());
      setSend({ sending: true, error: null, notice: null });
      dispatch({ kind: 'pending', item });
      try {
        const sent: SentMessage = await sendSessionMessage(sessionId, text);
        setSend({ sending: false, error: null, notice: sent.started ? null : NOT_STARTED });
        return true;
      } catch (error: unknown) {
        dispatch({ kind: 'unsent', id: item.id });
        setSend({ sending: false, error: sendFailure(error), notice: null });
        return false;
      }
    },
    [sessionId, send.sending],
  );

  const clearSendError = useCallback((): void => {
    setSend((current: SendState): SendState => ({ ...current, error: null, notice: null }));
  }, []);

  return { state, connection, expand, send, sendMessage, clearSendError };
};
