import type { Request, Response } from 'express';
import { httpError } from '../../../shared/utils/http-error.utils.js';
import type {
  ReplySessionPayload,
  ReplySessionResult,
  SessionUsecases,
} from '../sessions.types.js';

export const replySessionControllerFactory =
  (usecases: Pick<SessionUsecases, 'replySession'>) =>
  async (_req: Request, res: Response): Promise<void> => {
    const { sessionId, text }: ReplySessionPayload = res.locals.body as ReplySessionPayload;
    const result: ReplySessionResult = await usecases.replySession(sessionId, text);
    if (!result.ok) throw httpError(404, `no running factory session named "${sessionId}"`);
    res.json({ ok: true });
  };
