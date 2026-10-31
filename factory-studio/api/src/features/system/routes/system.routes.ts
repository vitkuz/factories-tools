import { Router } from 'express';
import { readMemoryControllerFactory } from '../controllers/index.js';
import type { SystemUsecases } from '../system.types.js';

/** The machine the API runs on: how busy its memory is, for the top bar indicator. */
export const createSystemRoutes = (usecases: SystemUsecases): Router => {
  const router: Router = Router();
  router.get('/system/memory', readMemoryControllerFactory(usecases));
  return router;
};
