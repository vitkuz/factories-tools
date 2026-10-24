import type { Request, Response } from 'express';
import type {
  UpdateWorkspaceResult,
  WorkspaceParams,
  WorkspacePayload,
  WorkspaceUsecases,
} from '../workspaces.types.js';
import { workspaceNotFound, workspacesFileUnreadable } from './workspace-errors.utils.js';

/** `PUT /workspaces/:id`: 200 with the workspace as saved, its id unchanged. */
export const updateWorkspaceControllerFactory =
  (usecases: Pick<WorkspaceUsecases, 'updateWorkspace'>) =>
  async (_req: Request, res: Response): Promise<void> => {
    const { id }: WorkspaceParams = res.locals.params as WorkspaceParams;
    const payload: WorkspacePayload = res.locals.body as WorkspacePayload;
    const result: UpdateWorkspaceResult = await usecases.updateWorkspace(id, payload);
    if (result.ok) {
      res.set('Cache-Control', 'no-store').json({ workspace: result.workspace });
      return;
    }
    if (result.reason === 'not-found') throw workspaceNotFound();
    throw workspacesFileUnreadable(result.problem);
  };
