import { Router } from 'express';
import { readScriptControllerFactory } from '../controllers/index.js';
import type { ScriptUsecases } from '../scripts.types.js';

/** E12: a hook script of the repository, read-only. HEAD is routed to GET by Express. */
export const createScriptsRoutes = (usecases: ScriptUsecases): Router => {
  const router: Router = Router();
  router.get('/scripts/*path', readScriptControllerFactory(usecases));
  return router;
};
