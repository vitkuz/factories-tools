import express, { Router, type RequestHandler } from 'express';
import { validateBody, validateParams } from '../../../shared/middleware/validate.js';
import {
  createWorkspaceControllerFactory,
  listWorkspacesControllerFactory,
  removeWorkspaceControllerFactory,
  updateWorkspaceControllerFactory,
} from '../controllers/index.js';
import { workspaceParamsSchema, workspacePayloadSchema } from '../workspaces.schema.js';
import type { WorkspaceUsecases } from '../workspaces.types.js';

const INVALID_ID = 'invalid workspace id';

/**
 * Workspaces: named sets of pipeline ids in `run/workspaces.json`. The `:id` is checked by
 * schema before anything reads the disk and never becomes part of a path. The JSON parser is
 * attached to the routes that take a body, never app-wide.
 */
export const createWorkspacesRoutes = (usecases: WorkspaceUsecases): Router => {
  const router: Router = Router();
  const jsonBody: RequestHandler = express.json({ limit: '1mb' });
  router.get('/workspaces', listWorkspacesControllerFactory(usecases));
  router.post(
    '/workspaces',
    jsonBody,
    validateBody(workspacePayloadSchema),
    createWorkspaceControllerFactory(usecases),
  );
  router.put(
    '/workspaces/:id',
    validateParams(workspaceParamsSchema, INVALID_ID),
    jsonBody,
    validateBody(workspacePayloadSchema),
    updateWorkspaceControllerFactory(usecases),
  );
  router.delete(
    '/workspaces/:id',
    validateParams(workspaceParamsSchema, INVALID_ID),
    removeWorkspaceControllerFactory(usecases),
  );
  return router;
};
