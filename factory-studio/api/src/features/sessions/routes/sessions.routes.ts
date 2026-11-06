import express, { Router, type RequestHandler } from 'express';
import { validateBody, validateParams } from '../../../shared/middleware/validate.js';
import { MAX_DOCUMENT_BYTES } from '../../documents/documents.utils.js';
import {
  listSessionsControllerFactory,
  replySessionControllerFactory,
  sendMessageControllerFactory,
  startSessionControllerFactory,
  stopSessionControllerFactory,
} from '../controllers/index.js';
import {
  replySessionPayloadSchema,
  sendMessagePayloadSchema,
  sessionIdParamsSchema,
  startSessionPayloadSchema,
  stopSessionPayloadSchema,
} from '../sessions.schema.js';
import type { SessionUsecases } from '../sessions.types.js';

/**
 * E9–E11 and the reply route. Path, method and validation only; the API key is checked one level up. The JSON
 * parser is attached to the routes that take a JSON body, never app-wide.
 */
export const createSessionsRoutes = (usecases: SessionUsecases): Router => {
  const router: Router = Router();
  const jsonBody: RequestHandler = express.json({ limit: MAX_DOCUMENT_BYTES });
  router.post(
    '/sessions',
    jsonBody,
    validateBody(startSessionPayloadSchema),
    startSessionControllerFactory(usecases),
  );
  router.get('/sessions', listSessionsControllerFactory(usecases));
  router.post(
    '/sessions/stop',
    jsonBody,
    validateBody(stopSessionPayloadSchema),
    stopSessionControllerFactory(usecases),
  );
  router.post(
    '/sessions/reply',
    jsonBody,
    validateBody(replySessionPayloadSchema),
    replySessionControllerFactory(usecases),
  );
  // The chat drawer's message box: a follow-up to a session at its prompt.
  router.post(
    '/sessions/:sessionId/messages',
    jsonBody,
    validateParams(sessionIdParamsSchema, 'invalid session id'),
    validateBody(sendMessagePayloadSchema),
    sendMessageControllerFactory(usecases),
  );
  return router;
};
