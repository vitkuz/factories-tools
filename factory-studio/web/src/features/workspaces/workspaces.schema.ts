import { z } from 'zod';

/** One workspace: a named set of factories (pipeline ids); an id need not be on disk. */
export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  pipelines: z.array(z.string()),
});

/** `GET /api/v1/workspaces`: `problem` is set when `run/workspaces.json` cannot be read. */
export const workspacesListSchema = z.object({
  exists: z.boolean(),
  workspaces: z.array(workspaceSchema),
  problem: z.string().optional(),
});

/** The body of a create or an update: the name and the factories, checked before it leaves. */
export const workspacePayloadSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(80, 'name is at most 80 characters'),
  pipelines: z.array(z.string()),
});

/** `POST` / `PUT /api/v1/workspaces[/:id]`: the workspace as written. */
export const createdWorkspaceSchema = z.object({ workspace: workspaceSchema });

/** `DELETE /api/v1/workspaces/:id`: the workspace that went. */
export const removedWorkspaceSchema = z.object({ removed: workspaceSchema });
