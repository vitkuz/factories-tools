import type {
  WorkspaceServices,
  WorkspacesListResponse,
  WorkspacesRead,
} from '../workspaces.types.js';

export type ListWorkspacesSettings = Pick<WorkspaceServices, 'readWorkspaces'>;

/** The workspaces on disk; a broken file answers no workspaces and says why in `problem`. */
export const listWorkspacesFactory =
  ({ readWorkspaces }: ListWorkspacesSettings) =>
  async (): Promise<WorkspacesListResponse> => {
    const read: WorkspacesRead = await readWorkspaces();
    if (!read.ok) return { exists: true, workspaces: [], problem: read.problem };
    return { exists: read.exists, workspaces: read.workspaces };
  };
