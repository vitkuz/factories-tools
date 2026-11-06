import type { z } from 'zod';
import type {
  createdWorkspaceSchema,
  removedWorkspaceSchema,
  workspacePayloadSchema,
  workspaceSchema,
  workspacesListSchema,
} from './workspaces.schema';

export type Workspace = z.infer<typeof workspaceSchema>;
export type WorkspacesList = z.infer<typeof workspacesListSchema>;
export type WorkspacePayload = z.infer<typeof workspacePayloadSchema>;
export type CreatedWorkspace = z.infer<typeof createdWorkspaceSchema>;
export type RemovedWorkspace = z.infer<typeof removedWorkspaceSchema>;

/** One factory the dialog offers: its id, and whether the studio knows it on disk. */
export interface WorkspaceOption {
  id: string;
  onDisk: boolean;
}

/** The workspaces as the hook holds them. */
export interface WorkspacesState {
  list: Workspace[];
  /** `run/workspaces.json` is there. */
  exists: boolean;
  /** The file is there but cannot be read; writes are refused until it is fixed by hand. */
  problem: string | null;
  /** No list has arrived over the socket yet. */
  loading: boolean;
  /** Nothing has ever arrived and the socket is down. */
  error: string | null;
}

/** How a write ended: the workspace written, or the API's refusal in one line. */
export type WorkspaceWriteResult =
  { ok: true; workspace: Workspace } | { ok: false; message: string };

/** The workspaces, the one chosen and the means to change them; what the context hands out. */
export interface Workspaces extends WorkspacesState {
  /** The chosen workspace, or `null` for All (nothing chosen, or the chosen one is gone). */
  selected: Workspace | null;
  /** The id kept in localStorage, even while it is not (or no longer) listed. */
  selectedId: string | null;
  select: (id: string | null) => void;
  create: (payload: WorkspacePayload) => Promise<WorkspaceWriteResult>;
  update: (id: string, payload: WorkspacePayload) => Promise<WorkspaceWriteResult>;
  remove: (id: string) => Promise<WorkspaceWriteResult>;
}

export type WorkspacesContextValue = Workspaces;
