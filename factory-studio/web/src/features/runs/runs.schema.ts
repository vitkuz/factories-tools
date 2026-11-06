import { z } from 'zod';
import { pipelineSchema } from './lib/dashboard.schema';

/**
 * The run list (E6) is parsed by the dashboard's own schemas, copied under `lib/`. The
 * envelope is checked as a whole; each run record is checked on its own so one broken
 * `state.json` hides that run and not the list (see `parseLivePayload`).
 */
export {
  dashboardEnvelopeSchema,
  runRecordSchema,
  dashboardDataSchema,
  describeIssues,
  type ParseIssue,
} from './lib/dashboard.schema';

/** E15's answer: where the removed run went. Paths are relative to the work dir. */
export const removedRunSchema = z.object({
  removed: z.object({
    pipelineId: z.string(),
    runId: z.string(),
    from: z.string(),
    trashedTo: z.string(),
  }),
});

/* ---------------------------------------------------------------- live feed (WebSocket) */

/**
 * The answer to a `runs` subscribe and every rescan: the same body as `GET /api/v1/runs`,
 * runs left unparsed so each is checked on its own (`parseLivePayload`).
 */
export const runsSnapshotMessageSchema = z.object({
  type: z.literal('runs.snapshot'),
  generatedAt: z.string(),
  pipelines: z.record(z.string(), pipelineSchema),
  runs: z.array(z.unknown()),
});

export const runGoneReasonSchema = z.enum(['gone', 'unreadable']);

/**
 * One run folder changed on disk. `run` set: its record now (`null`: it left the feed, see
 * `reason`). `run` absent: only files under it changed; `paths` names them (an open document
 * reloads itself). `folder` is where it is filed; `pipelineId` what its state declares.
 */
export const runChangedMessageSchema = z.object({
  type: z.literal('run.changed'),
  folder: z.string(),
  runId: z.string(),
  pipelineId: z.string().optional(),
  paths: z.array(z.string()),
  run: z.unknown().nullable().optional(),
  reason: runGoneReasonSchema.optional(),
});

/** A `pipeline.json` was written: the whole pipelines map again. */
export const pipelinesChangedMessageSchema = z.object({
  type: z.literal('pipelines.changed'),
  pipelines: z.record(z.string(), pipelineSchema),
});
