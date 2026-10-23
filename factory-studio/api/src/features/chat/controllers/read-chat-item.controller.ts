import type { Request, Response } from 'express';
import type { ZodSafeParseResult } from 'zod';
import { httpError } from '../../../shared/utils/http-error.utils.js';
import { chatItemQuerySchema } from '../chat.schema.js';
import type { ChatItemResult, ChatUsecases } from '../chat.types.js';
import { unavailableError } from './chat-http.utils.js';

/** `GET /sessions/:sessionId/chat/items/:itemId?ref=`: one item, uncut ("show more"). */
export const readChatItemControllerFactory =
  (usecases: Pick<ChatUsecases, 'readItem'>) =>
  async (req: Request, res: Response): Promise<void> => {
    const query: ZodSafeParseResult<{ ref: string }> = chatItemQuerySchema.safeParse(req.query);
    if (!query.success) throw httpError(400, 'invalid query', query.error.issues);
    const result: ChatItemResult = await usecases.readItem(
      String(req.params.sessionId),
      String(req.params.itemId),
      query.data.ref,
    );
    if (!result.ok) {
      throw result.reason === 'not-found'
        ? httpError(404, 'no such chat item')
        : unavailableError(result.reason);
    }
    res.json({ item: result.item });
  };
