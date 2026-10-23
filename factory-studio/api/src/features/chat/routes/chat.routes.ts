import express, { Router, type RequestHandler } from 'express';
import { validateBody } from '../../../shared/middleware/validate.js';
import {
  readChatHistoryControllerFactory,
  readChatItemControllerFactory,
  sessionStartControllerFactory,
} from '../controllers/index.js';
import { sessionStartPayloadSchema } from '../chat.schema.js';
import type { ChatUsecases } from '../chat.types.js';

/** The SessionStart hook endpoint and the REST side of the live chat. The API key is checked one level up. */
export const createChatRoutes = (usecases: ChatUsecases): Router => {
  const router: Router = Router();
  const jsonBody: RequestHandler = express.json({ limit: '64kb' });
  router.post(
    '/hooks/session-start',
    jsonBody,
    validateBody(sessionStartPayloadSchema),
    sessionStartControllerFactory(usecases),
  );
  router.get('/sessions/:sessionId/chat', readChatHistoryControllerFactory(usecases));
  router.get('/sessions/:sessionId/chat/items/:itemId', readChatItemControllerFactory(usecases));
  return router;
};
