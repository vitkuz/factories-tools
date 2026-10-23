import type { Request, Response } from 'express';
import type { ZodSafeParseResult } from 'zod';
import { httpError } from '../../../shared/utils/http-error.utils.js';
import { chatHistoryQuerySchema } from '../chat.schema.js';
import type { ChatHistoryResult, ChatUsecases } from '../chat.types.js';
import { unavailableError } from './chat-http.utils.js';

/** `GET /sessions/:sessionId/chat?limit=`: the newest items of the session's transcript. */
export const readChatHistoryControllerFactory =
  (usecases: Pick<ChatUsecases, 'history'>) =>
  async (req: Request, res: Response): Promise<void> => {
    const query: ZodSafeParseResult<{ limit: number }> = chatHistoryQuerySchema.safeParse(
      req.query,
    );
    if (!query.success) throw httpError(400, 'invalid query', query.error.issues);
    const result: ChatHistoryResult = await usecases.history(
      String(req.params.sessionId),
      query.data.limit,
    );
    if (!result.ok) throw unavailableError(result.reason);
    res.json(result.history);
  };
