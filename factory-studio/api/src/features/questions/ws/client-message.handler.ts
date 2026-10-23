import type { ZodSafeParseResult } from 'zod';
import type { AppLogger } from '../../../shared/types.js';
import type { ReplySessionResult } from '../../sessions/sessions.types.js';
import { clientMessageSchema } from '../questions.schema.js';
import type {
  ClientMessage,
  QuestionActionResult,
  QuestionUsecases,
  ServerMessage,
} from '../questions.types.js';

export interface ClientMessageSettings {
  usecases: Pick<QuestionUsecases, 'answerQuestion' | 'dismissQuestion'>;
  replySession: (sessionId: string, text: string) => Promise<ReplySessionResult>;
  logger?: AppLogger;
}

const parseFrame = (raw: string): ZodSafeParseResult<ClientMessage> => {
  try {
    return clientMessageSchema.safeParse(JSON.parse(raw));
  } catch {
    return clientMessageSchema.safeParse(undefined);
  }
};

const failure = (ref: string, message: string): ServerMessage => ({ type: 'error', message, ref });

const actionFailure = (ref: string, result: QuestionActionResult): ServerMessage | null =>
  result.ok
    ? null
    : failure(ref, result.reason === 'not-found' ? 'no such pending question' : result.message);

/**
 * One client frame in, at most one error frame out. The success path is silent: the client
 * learns it from the broadcast `session.question.resolved`.
 */
export const handleClientMessageFactory =
  ({ usecases, replySession, logger }: ClientMessageSettings) =>
  async (raw: string): Promise<ServerMessage | null> => {
    const parsed: ZodSafeParseResult<ClientMessage> = parseFrame(raw);
    if (!parsed.success) {
      logger?.warn('ws: bad client frame', { issues: parsed.error.issues.length });
      return { type: 'error', message: 'invalid message' };
    }
    const message: ClientMessage = parsed.data;
    switch (message.type) {
      case 'session.answer':
        return actionFailure(message.type, usecases.answerQuestion(message));
      case 'session.dismiss':
        return actionFailure(message.type, usecases.dismissQuestion(message));
      case 'session.reply': {
        const result: ReplySessionResult = await replySession(message.sessionId, message.text);
        return result.ok
          ? null
          : failure(message.type, `no running session "${message.sessionId}"`);
      }
    }
  };
