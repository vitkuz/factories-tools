import express, { Router, type RequestHandler } from 'express';
import { validateBody } from '../../../shared/middleware/validate.js';
import { MAX_DOCUMENT_BYTES } from '../../documents/documents.utils.js';
import {
  listSessionsControllerFactory,
  startSessionControllerFactory,
  stopSessionControllerFactory,
} from '../controllers/index.js';
import { startSessionPayloadSchema, stopSessionPayloadSchema } from '../sessions.schema.js';
import type { SessionUsecases } from '../sessions.types.js';

/**
 * E9–E11. Path, method and validation only; the API key is checked one level up. The JSON
 * parser is attached to the two routes that take a JSON body, never app-wide.
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
  return router;
};
