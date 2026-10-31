import express, { Router } from 'express';
import { MAX_DOCUMENT_BYTES } from '../../documents/documents.utils.js';
import {
  listPipelinesControllerFactory,
  readKnowledgeControllerFactory,
  writeKnowledgeControllerFactory,
} from '../controllers/index.js';
import type { PipelineUsecases } from '../pipelines.types.js';

/**
 * E2 and E5 read: the list the Sessions screen starts from, and the knowledge files a run's
 * steps name. E16 writes a knowledge file of the project's own factories (`factories.local`),
 * the body read as text of at most 2 MB, as E8 reads it. Paths and methods only. HEAD is
 * routed to GET by Express.
 */
export const createPipelinesRoutes = (usecases: PipelineUsecases): Router => {
  const router: Router = Router();
  router.get('/pipelines', listPipelinesControllerFactory(usecases));
  router.get('/pipelines/:id/knowledge/*path', readKnowledgeControllerFactory(usecases));
  router.put(
    '/pipelines/:id/knowledge/*path',
    express.text({ type: (): boolean => true, limit: MAX_DOCUMENT_BYTES }),
    writeKnowledgeControllerFactory(usecases),
  );
  return router;
};
