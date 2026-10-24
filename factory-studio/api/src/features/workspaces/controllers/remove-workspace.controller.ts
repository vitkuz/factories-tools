import type { Request, Response } from 'express';
import type {
  RemoveWorkspaceResult,
  WorkspaceParams,
  WorkspaceUsecases,
} from '../workspaces.types.js';
import { workspaceNotFound, workspacesFileUnreadable } from './workspace-errors.utils.js';

/** `DELETE /workspaces/:id`: 200 with the workspace that was dropped from the file. */
export const removeWorkspaceControllerFactory =
  (usecases: Pick<WorkspaceUsecases, 'removeWorkspace'>) =>
  async (_req: Request, res: Response): Promise<void> => {
    const { id }: WorkspaceParams = res.locals.params as WorkspaceParams;
    const result: RemoveWorkspaceResult = await usecases.removeWorkspace(id);
    if (result.ok) {
      res.set('Cache-Control', 'no-store').json({ removed: result.removed });
      return;
    }
    if (result.reason === 'not-found') throw workspaceNotFound();
    throw workspacesFileUnreadable(result.problem);
  };
