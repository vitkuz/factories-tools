import { z } from 'zod';
import { runSegmentSchema } from '../runs/runs.schema.js';

const isUnique = (values: readonly string[]): boolean => new Set(values).size === values.length;

/** A workspace id: a slug, made from the name on create and kept on rename. Never a path. */
export const workspaceIdSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'not a workspace id');

export const workspaceNameSchema = z.string().trim().min(1).max(80);

/** Pipeline ids, each one folder name; an id not on disk is allowed (the UI greys it). */
export const workspacePipelinesSchema = z
  .array(runSegmentSchema)
  .max(200)
  .refine(isUnique, 'pipeline ids must be unique');

export const workspaceSchema = z.object({
  id: workspaceIdSchema,
  name: workspaceNameSchema,
  pipelines: workspacePipelinesSchema,
});

/** `run/workspaces.json`, as written by the API or by hand. */
export const workspacesFileSchema = z.object({
  workspaces: z
    .array(workspaceSchema)
    .refine(
      (workspaces: readonly { id: string }[]): boolean =>
        isUnique(workspaces.map((workspace: { id: string }): string => workspace.id)),
      'workspace ids must be unique',
    ),
});

/** `POST /workspaces` and `PUT /workspaces/:id`. */
export const workspacePayloadSchema = z.object({
  name: workspaceNameSchema,
  pipelines: workspacePipelinesSchema,
});

/** `PUT /workspaces/:id` and `DELETE /workspaces/:id`. */
export const workspaceParamsSchema = z.object({
  id: workspaceIdSchema,
});
