import type {
  CreateWorkspaceResult,
  Workspace,
  WorkspacePayload,
  WorkspaceServices,
  WorkspacesFile,
  WorkspacesRead,
} from '../workspaces.types.js';
import { findWorkspace, slugify, withWorkspace } from '../workspaces.utils.js';

export type CreateWorkspaceSettings = WorkspaceServices;

/**
 * Adds a workspace whose id is the slug of its name. An id already in the file is refused,
 * not renamed, and so is any write over a file that cannot be read back.
 */
export const createWorkspaceFactory =
  ({ readWorkspaces, writeWorkspaces }: CreateWorkspaceSettings) =>
  async (payload: WorkspacePayload): Promise<CreateWorkspaceResult> => {
    const read: WorkspacesRead = await readWorkspaces();
    if (!read.ok) return { ok: false, reason: 'file-unreadable', problem: read.problem };
    const workspace: Workspace = {
      id: slugify(payload.name),
      name: payload.name,
      pipelines: payload.pipelines,
    };
    const current: WorkspacesFile = { workspaces: read.workspaces };
    if (findWorkspace(current, workspace.id) !== undefined) {
      return { ok: false, reason: 'id-taken', id: workspace.id };
    }
    await writeWorkspaces(withWorkspace(current, workspace));
    return { ok: true, workspace };
  };
