import type { Request, Response } from 'express';
import type { WorkspaceUsecases, WorkspacesListResponse } from '../workspaces.types.js';

/** `GET /workspaces`: always 200; a broken file is reported in `problem`. */
export const listWorkspacesControllerFactory =
  (usecases: Pick<WorkspaceUsecases, 'listWorkspaces'>) =>
  async (_req: Request, res: Response): Promise<void> => {
    const payload: WorkspacesListResponse = await usecases.listWorkspaces();
    res.set('Cache-Control', 'no-store').json(payload);
  };
