import type { Request, Response } from 'express';
import { httpError } from '../../../shared/utils/http-error.utils.js';
import type { HttpError } from '../../../shared/types.js';
import type {
  SendMessagePayload,
  SendMessageResult,
  SessionIdParams,
  SessionUsecases,
} from '../sessions.types.js';

/** The refusal, as the app shows it under the message box. 409: not now; 404: not at all. */
export const refusalError = (result: Exclude<SendMessageResult, { ok: true }>): HttpError => {
  switch (result.reason) {
    case 'not-found':
      return httpError(404, 'no running session by this name', { reason: result.reason });
    case 'in-flight':
      return httpError(409, 'a message to this session is still being sent', {
        reason: result.reason,
      });
    case 'question':
      return httpError(409, 'Claude is waiting for your answer to its question', {
        reason: result.reason,
      });
    case 'not-idle':
      return httpError(
        409,
        result.status === 'working'
          ? 'Claude is still working; wait for the turn to finish'
          : result.status === 'blocked'
            ? 'Claude is waiting in the terminal; answer there first'
            : 'the session is not ready for a message',
        { reason: result.reason, status: result.status },
      );
    case 'herdr':
      return result.code === 'agent_blocked'
        ? httpError(409, 'Claude is waiting in a dialog in the terminal; answer there first', {
            reason: result.reason,
            code: result.code,
          })
        : httpError(502, `herdr could not deliver the message: ${result.message}`, {
            reason: result.reason,
            code: result.code,
          });
  }
};

/** `POST /sessions/:sessionId/messages`: 202 once herdr has the text, with whether Claude started. */
export const sendMessageControllerFactory =
  (usecases: Pick<SessionUsecases, 'sendMessage'>) =>
  async (_req: Request, res: Response): Promise<void> => {
    const { sessionId }: SessionIdParams = res.locals.params as SessionIdParams;
    const { text }: SendMessagePayload = res.locals.body as SendMessagePayload;
    const result: SendMessageResult = await usecases.sendMessage(sessionId, text);
    if (!result.ok) throw refusalError(result);
    res.status(202).json({ ok: true, sessionId, started: result.started });
  };
