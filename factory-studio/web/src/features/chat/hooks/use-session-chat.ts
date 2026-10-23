import { useCallback, useEffect, useReducer } from 'react';
import { describeApiError, isApiError } from '../../../adapters/http/api-error.utils';
import { readChatItem } from '../../../adapters/http/studio-api.adapter';
import type { SocketState } from '../../../shared/lib/use-websocket';
import { useQuestions } from '../../sessions/hooks/use-questions';
import type { SessionQuestions } from '../../sessions/hooks/use-session-questions';
import type { ServerMessage } from '../../sessions/sessions.types';
import type { ChatAction, ChatItem, ChatState } from '../chat.types';
import { initialChatState, reduceChat } from '../chat.utils';

export interface SessionChat {
  state: ChatState;
  connection: SocketState;
  /** Fetches the whole of a cut item and puts it in place. */
  expand: (item: ChatItem) => Promise<void>;
}

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

/**
 * One session's live chat over the app's one socket: subscribes on mount and again after every
 * reconnect (the backlog then replaces what is held), unsubscribes on unmount.
 */
export const useSessionChat = (sessionId: string): SessionChat => {
  const questions: SessionQuestions = useQuestions();
  const { channel, connection } = questions;
  const [state, dispatch] = useReducer<ChatState, [ChatAction]>(reduceChat, initialChatState);

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

  return { state, connection, expand };
};
