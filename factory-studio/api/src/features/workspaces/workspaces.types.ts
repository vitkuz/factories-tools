import type { z } from 'zod';
import type {
  workspaceParamsSchema,
  workspacePayloadSchema,
  workspaceSchema,
  workspacesFileSchema,
} from './workspaces.schema.js';

export type Workspace = z.infer<typeof workspaceSchema>;
export type WorkspacesFile = z.infer<typeof workspacesFileSchema>;
export type WorkspacePayload = z.infer<typeof workspacePayloadSchema>;
export type WorkspaceParams = z.infer<typeof workspaceParamsSchema>;

/** `run/workspaces.json` as read: absent is no workspaces; broken is a problem, never a throw. */
export type WorkspacesRead =
  { ok: true; exists: boolean; workspaces: Workspace[] } | { ok: false; problem: string };

/** What `GET /workspaces` answers. A broken file still answers 200, with `problem` set. */
export interface WorkspacesListResponse {
  exists: boolean;
  workspaces: Workspace[];
  problem?: string;
}

/** The file is there but cannot be read back, so a write would clobber a hand edit. */
export interface WorkspacesFileUnreadable {
  ok: false;
  reason: 'file-unreadable';
  problem: string;
}

export type CreateWorkspaceResult =
  | { ok: true; workspace: Workspace }
  | { ok: false; reason: 'id-taken'; id: string }
  | WorkspacesFileUnreadable;

export type UpdateWorkspaceResult =
  | { ok: true; workspace: Workspace }
  | { ok: false; reason: 'not-found' }
  | WorkspacesFileUnreadable;

export type RemoveWorkspaceResult =
  { ok: true; removed: Workspace } | { ok: false; reason: 'not-found' } | WorkspacesFileUnreadable;

export interface WorkspaceServices {
  readWorkspaces: () => Promise<WorkspacesRead>;
  /** Writes the whole file atomically; returns the bytes written. */
  writeWorkspaces: (file: WorkspacesFile) => Promise<number>;
}

/** What `server.ts` hands the routes. */
export interface WorkspaceUsecases {
  listWorkspaces: () => Promise<WorkspacesListResponse>;
  createWorkspace: (payload: WorkspacePayload) => Promise<CreateWorkspaceResult>;
  updateWorkspace: (id: string, payload: WorkspacePayload) => Promise<UpdateWorkspaceResult>;
  removeWorkspace: (id: string) => Promise<RemoveWorkspaceResult>;
}
