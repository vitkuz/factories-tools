import { Router } from 'express';
import {
  listPipelinesControllerFactory,
  readKnowledgeControllerFactory,
} from '../controllers/index.js';
import type { PipelineUsecases } from '../pipelines.types.js';

/**
 * E2 and E5, both read-only: the list the Sessions screen starts from, and the knowledge
 * files a run's steps name. Paths and methods only. HEAD is routed to GET by Express.
 */
export const createPipelinesRoutes = (usecases: PipelineUsecases): Router => {
  const router: Router = Router();
  router.get('/pipelines', listPipelinesControllerFactory(usecases));
  router.get('/pipelines/:id/knowledge/*path', readKnowledgeControllerFactory(usecases));
  return router;
};
