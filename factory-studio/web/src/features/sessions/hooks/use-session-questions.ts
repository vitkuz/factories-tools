import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  parseServerMessage,
  serializeClientMessage,
  sessionsSocketUrl,
} from '../../../adapters/ws/sessions-socket.adapter';
import { useWebSocket, type SocketState } from '../../../shared/lib/use-websocket';
import type {
  Answer,
  ClientMessage,
  PendingQuestion,
  QuestionsAction,
  QuestionsState,
  ServerMessage,
} from '../sessions.types';
import { initialQuestionsState, reduceQuestions } from '../sessions.utils';

const NOT_CONNECTED =
  'Not connected to the API. Wait for the reconnect, or answer in the terminal.';
const SOCKET_URL: string = sessionsSocketUrl();

/** Every frame the socket receives, for a screen that reads more than the questions (the live chat). */
export type FrameListener = (message: ServerMessage) => void;

/** The shared socket as the live chat uses it: send a frame, hear every frame. */
export interface SocketChannel {
  /** `false` when the socket is not open and nothing was sent. */
  send: (message: ClientMessage) => boolean;
  /** Returns the function that stops listening. */
  listen: (listener: FrameListener) => () => void;
}

export interface SessionQuestions {
  state: QuestionsState;
  connection: SocketState;
  answer: (question: PendingQuestion, answers: Answer[]) => void;
  clearError: () => void;
  channel: SocketChannel;
}

/** The questions Claude asks, the sessions' live status, and the means to answer over the socket. */
export const useSessionQuestions = (): SessionQuestions => {
  const [state, dispatch] = useReducer<QuestionsState, [QuestionsAction]>(
    reduceQuestions,
    initialQuestionsState,
  );

  const listeners = useRef<ReadonlySet<FrameListener>>(new Set());

  const onMessage = useCallback((message: ServerMessage): void => {
    dispatch({ kind: 'message', message });
    listeners.current.forEach((listener: FrameListener): void => listener(message));
  }, []);

  const socket = useWebSocket<ServerMessage, ClientMessage>({
    url: SOCKET_URL,
    parse: parseServerMessage,
    serialize: serializeClientMessage,
    onMessage,
  });
  const { send } = socket;

  useEffect((): void => {
    if (socket.state === 'closed') dispatch({ kind: 'disconnected' });
  }, [socket.state]);

  const answer = useCallback(
    (question: PendingQuestion, answers: Answer[]): void => {
      dispatch({ kind: 'sending', promptId: question.promptId });
      const sent: boolean = send({
        type: 'session.answer',
        sessionId: question.sessionId,
        promptId: question.promptId,
        answers,
      });
      if (!sent) dispatch({ kind: 'failed', promptId: question.promptId, message: NOT_CONNECTED });
    },
    [send],
  );

  const clearError = useCallback((): void => dispatch({ kind: 'clear-error' }), []);

  const channel: SocketChannel = useMemo(
    (): SocketChannel => ({
      send,
      listen: (listener: FrameListener): (() => void) => {
        listeners.current = new Set([...listeners.current, listener]);
        return (): void => {
          listeners.current = new Set(
            [...listeners.current].filter((other: FrameListener): boolean => other !== listener),
          );
        };
      },
    }),
    [send],
  );

  return { state, connection: socket.state, answer, clearError, channel };
};
