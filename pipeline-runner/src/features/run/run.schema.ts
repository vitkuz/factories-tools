import { z } from 'zod';
import { scalarSchema } from '../pipeline/pipeline.schema.js';

/** Mirrors factories/state.schema.json. A resumed run is parsed with it before it is trusted. */

export const stepRecordSchema = z.strictObject({
  order: z.number().int(),
  kind: z.enum(['agent', 'pipeline']).optional(),
  agent: z.string().optional(),
  sessionId: z.string().optional(),
  transcriptPath: z.string().optional(),
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED', 'RETRYING']),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  outputs: z.array(z.string()).optional(),
  retryCount: z.number().int().optional(),
  error: z.string().optional(),
  skipReason: z.string().optional(),
  childPipeline: z.record(z.string(), z.unknown()).optional(),
  passes: z.number().int().optional(),
  event: z.string().optional(),
  reported: z.record(z.string(), scalarSchema).optional(),
  note: z.string().optional(),
});

export const historyEventSchema = z.strictObject({
  timestamp: z.string(),
  type: z.enum([
    'PIPELINE_INIT',
    'WAVE_START',
    'STEP_START',
    'STEP_COMPLETE',
    'STEP_FAIL',
    'STEP_RETRY',
    'STEP_SKIP',
    'PIPELINE_PAUSE',
    'PIPELINE_RESUME',
    'PIPELINE_COMPLETE',
    'PIPELINE_FAIL',
    'CHILD_PIPELINE_START',
    'CHILD_PIPELINE_COMPLETE',
    'CHILD_PIPELINE_FAIL',
    'STEP_EVENT',
    'EDGE_CAPPED',
    'HUMAN_ANSWER',
  ]),
  step: z.string().optional(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

/** What a harness reports instead of dollars: tokens, or Copilot's premium requests. */
export const usageSchema = z.object({
  inputTokens: z.number().optional(),
  cachedInputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  premiumRequests: z.number().optional(),
});

/**
 * `context.captured` is the one free-form corner of the state file, so what this runner must
 * remember to resume a run lives there: the pinned variables and the routing memory.
 */
export const capturedSchema = z.object({
  runner: z.literal('pipeline-runner').default('pipeline-runner'),
  slug: z.string().default(''),
  date: z.string().default(''),
  outputDir: z.string().default(''),
  /** Steps routed into while they were still running: they go again once they finish. */
  requeued: z.array(z.string()).default([]),
  enteredBy: z.record(z.string(), z.object({ from: z.string(), event: z.string() })).default({}),
  costUsd: z.number().default(0),
  /** The harness the steps run on, so `resume` goes on with the same one. */
  harness: z.string().optional(),
  /** What the harnesses that report no dollars reported instead, summed over the run. */
  usage: usageSchema.default({}),
});

export const runStateSchema = z.strictObject({
  $schema: z.string().optional(),
  runId: z.string(),
  pipelineName: z.string(),
  pipelineFile: z.string(),
  sessionId: z.string().nullish(),
  sessionSource: z.string().nullish(),
  transcriptPath: z.string().nullish(),
  status: z.enum(['IDLE', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'ABORTED']),
  createdAt: z.string(),
  updatedAt: z.string(),
  currentWave: z.number().int(),
  activeSteps: z.array(z.string()).default([]),
  context: z.strictObject({
    constants: z.record(z.string(), z.string()),
    params: z.record(z.string(), scalarSchema),
    captured: capturedSchema,
  }),
  pause: z.unknown().optional(),
  steps: z.record(z.string(), stepRecordSchema),
  history: z.array(historyEventSchema).default([]),
  mode: z.literal('graph').default('graph'),
  frontier: z
    .array(z.string())
    .nullish()
    .transform((value): string[] => value ?? []),
  edges: z
    .record(z.string(), z.number().int())
    .nullish()
    .transform((value): Record<string, number> => value ?? {}),
  vars: z
    .record(z.string(), scalarSchema)
    .nullish()
    .transform((value): Record<string, string | number | boolean> => value ?? {}),
});
