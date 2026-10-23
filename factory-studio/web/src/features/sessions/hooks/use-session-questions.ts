import { useCallback, useEffect, useReducer } from 'react';
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

export interface SessionQuestions {
  state: QuestionsState;
  connection: SocketState;
  answer: (question: PendingQuestion, answers: Answer[]) => void;
  clearError: () => void;
}

/** The questions Claude asks, the sessions' live status, and the means to answer over the socket. */
export const useSessionQuestions = (): SessionQuestions => {
  const [state, dispatch] = useReducer<QuestionsState, [QuestionsAction]>(
    reduceQuestions,
    initialQuestionsState,
  );

  const onMessage = useCallback(
    (message: ServerMessage): void => dispatch({ kind: 'message', message }),
    [],
  );

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

  return { state, connection: socket.state, answer, clearError };
};
