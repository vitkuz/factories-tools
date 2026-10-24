import type {
  RemoveWorkspaceResult,
  Workspace,
  WorkspaceServices,
  WorkspacesFile,
  WorkspacesRead,
} from '../workspaces.types.js';
import { findWorkspace, withoutWorkspace } from '../workspaces.utils.js';

export type RemoveWorkspaceSettings = WorkspaceServices;

/** Drops a workspace from the file. The factories and runs it listed are not touched. */
export const removeWorkspaceFactory =
  ({ readWorkspaces, writeWorkspaces }: RemoveWorkspaceSettings) =>
  async (id: string): Promise<RemoveWorkspaceResult> => {
    const read: WorkspacesRead = await readWorkspaces();
    if (!read.ok) return { ok: false, reason: 'file-unreadable', problem: read.problem };
    const current: WorkspacesFile = { workspaces: read.workspaces };
    const removed: Workspace | undefined = findWorkspace(current, id);
    if (removed === undefined) return { ok: false, reason: 'not-found' };
    await writeWorkspaces(withoutWorkspace(current, id));
    return { ok: true, removed };
  };
