import { z } from 'zod';

/**
 * The live feed over the WebSocket: a client names the topics it wants, the server answers each
 * with a snapshot and then pushes every change. Questions and chat keep their own frames; this
 * is for what the browser used to poll over HTTP.
 */

export const liveTopicSchema = z.enum(['runs', 'sessions', 'workspaces', 'system']);

/** client -> server */
export const liveClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('live.subscribe'), topics: z.array(liveTopicSchema).min(1).max(8) }),
  z.object({
    type: z.literal('live.unsubscribe'),
    topics: z.array(liveTopicSchema).min(1).max(8),
  }),
]);

/** Why a run left the feed. */
export const runGoneReasonSchema = z.enum(['gone', 'unreadable']);

/**
 * server -> client. Run records and pipelines travel as they are read from disk (`unknown` here:
 * the API's own `RunRecord`), and the app checks each run on its own, as it does for GET /runs.
 */
export const liveServerMessageSchema = z.discriminatedUnion('type', [
  /** The answer to `live.subscribe` for `runs`: the same body as GET /api/v1/runs. */
  z.object({
    type: z.literal('runs.snapshot'),
    generatedAt: z.string(),
    pipelines: z.record(z.string(), z.unknown()),
    runs: z.array(z.unknown()),
  }),
  /**
   * One run folder changed. `run` present: the record as it is now (`null`: the run is out of
   * the feed, see `reason`). `run` absent: only files under the run changed; `paths` says which.
   */
  z.object({
    type: z.literal('run.changed'),
    folder: z.string(),
    runId: z.string(),
    pipelineId: z.string().optional(),
    paths: z.array(z.string()),
    run: z.unknown().nullable().optional(),
    reason: runGoneReasonSchema.optional(),
  }),
  /** A pipeline.json was written under factories/ or factories.local/: the whole map, as GET /runs carries it. */
  z.object({ type: z.literal('pipelines.changed'), pipelines: z.record(z.string(), z.unknown()) }),
  /** The session list, whole, whenever it differs (also the answer to a `sessions` subscribe). */
  z.object({ type: z.literal('sessions.changed'), sessions: z.array(z.unknown()) }),
  /** The answer to a `workspaces` subscribe and every change of `run/workspaces.json`. */
  z.object({
    type: z.literal('workspaces.snapshot'),
    exists: z.boolean(),
    workspaces: z.array(z.unknown()),
    problem: z.string().optional(),
  }),
  /** The machine's memory, every few seconds while someone listens. */
  z.object({
    type: z.literal('system.memory'),
    totalBytes: z.number(),
    usedBytes: z.number(),
    availableBytes: z.number(),
    usedPercent: z.number(),
    loadAverage: z.array(z.number()),
    cpuCount: z.number(),
  }),
]);
