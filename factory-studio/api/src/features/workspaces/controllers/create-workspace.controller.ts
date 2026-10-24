import type { Request, Response } from 'express';
import { httpError } from '../../../shared/utils/http-error.utils.js';
import type {
  CreateWorkspaceResult,
  WorkspacePayload,
  WorkspaceUsecases,
} from '../workspaces.types.js';
import { workspacesFileUnreadable } from './workspace-errors.utils.js';

/** `POST /workspaces`: 201 with the new workspace, 409 when its id is taken or the file broken. */
export const createWorkspaceControllerFactory =
  (usecases: Pick<WorkspaceUsecases, 'createWorkspace'>) =>
  async (_req: Request, res: Response): Promise<void> => {
    const payload: WorkspacePayload = res.locals.body as WorkspacePayload;
    const result: CreateWorkspaceResult = await usecases.createWorkspace(payload);
    if (result.ok) {
      res.set('Cache-Control', 'no-store').status(201).json({ workspace: result.workspace });
      return;
    }
    if (result.reason === 'id-taken') {
      throw httpError(409, `a workspace with id "${result.id}" already exists`, { id: result.id });
    }
    throw workspacesFileUnreadable(result.problem);
  };
