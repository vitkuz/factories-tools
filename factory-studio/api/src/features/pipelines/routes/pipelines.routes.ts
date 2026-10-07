import express, { Router, type RequestHandler } from 'express';
import { validateBody } from '../../../shared/middleware/validate.js';
import { MAX_DOCUMENT_BYTES } from '../../documents/documents.utils.js';
import {
  createPipelineControllerFactory,
  listPipelinesControllerFactory,
  readKnowledgeControllerFactory,
  readPipelineControllerFactory,
  savePipelineControllerFactory,
} from '../controllers/index.js';
import { newPipelineFileSchema, pipelineFileSchema } from '../pipelines.schema.js';
import type { PipelineUsecases } from '../pipelines.types.js';

/**
 * E2–E5 and the create (E4b). Paths, methods and body validation only. HEAD is routed to GET
 * by Express. The JSON parser is attached to the two routes that take a JSON body, never
 * app-wide.
 */
export const createPipelinesRoutes = (usecases: PipelineUsecases): Router => {
  const router: Router = Router();
  const jsonBody: RequestHandler = express.json({ limit: MAX_DOCUMENT_BYTES });
  router.get('/pipelines', listPipelinesControllerFactory(usecases));
  router.post(
    '/pipelines',
    jsonBody,
    validateBody(newPipelineFileSchema),
    createPipelineControllerFactory(usecases),
  );
  router.get('/pipelines/:id', readPipelineControllerFactory(usecases));
  router.put(
    '/pipelines/:id',
    jsonBody,
    validateBody(pipelineFileSchema),
    savePipelineControllerFactory(usecases),
  );
  router.get('/pipelines/:id/knowledge/*path', readKnowledgeControllerFactory(usecases));
  return router;
};
