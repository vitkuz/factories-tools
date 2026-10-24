import type {
  UpdateWorkspaceResult,
  Workspace,
  WorkspacePayload,
  WorkspaceServices,
  WorkspacesFile,
  WorkspacesRead,
} from '../workspaces.types.js';
import { findWorkspace, withWorkspace } from '../workspaces.utils.js';

export type UpdateWorkspaceSettings = WorkspaceServices;

/** Replaces a workspace's name and pipelines; the id stays what it was, whatever the new name. */
export const updateWorkspaceFactory =
  ({ readWorkspaces, writeWorkspaces }: UpdateWorkspaceSettings) =>
  async (id: string, payload: WorkspacePayload): Promise<UpdateWorkspaceResult> => {
    const read: WorkspacesRead = await readWorkspaces();
    if (!read.ok) return { ok: false, reason: 'file-unreadable', problem: read.problem };
    const current: WorkspacesFile = { workspaces: read.workspaces };
    if (findWorkspace(current, id) === undefined) return { ok: false, reason: 'not-found' };
    const workspace: Workspace = { id, name: payload.name, pipelines: payload.pipelines };
    await writeWorkspaces(withWorkspace(current, workspace));
    return { ok: true, workspace };
  };
