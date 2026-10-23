import { z } from 'zod';
import { discoveredPipelineSchema } from '../pipelines/pipelines.schema.js';

/** Only the fields the API reads; every other recorder field passes through. */
export const runStateFileSchema = z.looseObject({
  pipelineName: z.string().optional(),
  pipeline: z.string().optional(),
  createdAt: z.string().optional(),
  startAt: z.string().optional(),
  status: z.string().optional(),
});

/**
 * Who opened the run, as the recorder wrote it: the harness session id, on the state itself or
 * on its `PIPELINE_INIT` entry. Read on its own, so a run whose history has another shape is
 * still listed; it only cannot be linked to a session.
 */
export const runSessionStampSchema = z.looseObject({
  sessionId: z.string().optional(),
  history: z
    .array(
      z.looseObject({
        type: z.string().optional(),
        details: z.looseObject({ sessionId: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});

/** Which run a session's question belongs to, and how that was decided. */
export const sessionRunLinkSchema = z.object({
  pipelineId: z.string().min(1),
  runId: z.string().min(1),
  /** `session`: the run was opened by the asking Claude session. `started-after`: the fallback. */
  match: z.enum(['session', 'started-after']),
});

/**
 * One run id or pipeline id from a URL: one folder name. Letters, digits, `.`, `_` and `-`,
 * not starting with a dot, never `..` anywhere: no separator, no traversal, no hidden folder.
 */
export const runSegmentSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9._-]*$/, 'not a run folder name')
  .refine((value: string): boolean => !value.includes('..'), 'not a run folder name');

/** `DELETE /runs/:pipelineId/:runId`. */
export const runParamsSchema = z.object({
  pipelineId: runSegmentSchema,
  runId: runSegmentSchema,
});

export const costFileSchema = z.looseObject({});

export const runPipelineFileSchema = discoveredPipelineSchema;
