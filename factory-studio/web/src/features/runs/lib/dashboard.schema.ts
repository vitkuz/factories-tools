import { z } from 'zod';
import { isLegacyState, upgradeLegacyState, upgradeLegacyStep } from './legacy';

/**
 * Runtime validation for everything the dashboard consumes: every live `GET /api/v1/runs`
 * payload (E6).
 *
 * These are the factories' own file formats, read as they are written — the only
 * translation between disk and screen is the upgrade of the two older dialects in
 * `legacy.ts` (an older recorder's `state.json`, and a run's `pipeline.json` snapshot with
 * string prompts):
 *
 *   pipeline.json  `factories/pipeline.schema.json`
 *                  (the definition at `factories/<id>/pipeline.json`, and a run's snapshot)
 *   state.json     `factories/state.schema.json`
 *   cost.json      written by `factories-tools/ai-usage`
 *
 * Objects are loose, so a newer field added by the harness passes through untouched.
 */

/* ------------------------------------------------------------------ pipeline.json */

/**
 * Where one event leads. `max` caps how often the run may take this edge (the state file's
 * `edges` counter enforces it) and `onMax` is where it goes once the cap is spent.
 */
export const routeSchema = z.looseObject({
  target: z.array(z.string()),
  max: z.number().int().optional(),
  onMax: z.array(z.string()).optional(),
});

/**
 * One step. `prompt` and `system` are arrays of lines (the text is the lines joined with
 * "\n"); a snapshot from before that format — a string `prompt`, a `systemPrompt` — is
 * upgraded first (see `legacy.ts`) so every old run still draws.
 */
export const pipelineStepSchema = z.preprocess(
  upgradeLegacyStep,
  z.looseObject({
    agent: z.string(),
    model: z.string().nullable().optional(),
    system: z.array(z.string()).optional(),
    prompt: z.array(z.string()),
    input: z.array(z.string()).default([]),
    output: z.array(z.string()).default([]),
    /** Files the agent reads before starting (`{{factoryPath}}/knowledge/…`, the factory's own). */
    knowledge: z.array(z.string()).optional(),
    workDir: z.string().optional(),
    transitions: z.record(z.string(), routeSchema).default({}),
  }),
);

/** Shell commands the harness runs around the whole run (`before` the first step, `after` the last). */
export const hooksSchema = z.looseObject({
  before: z.array(z.string()).optional(),
  after: z.array(z.string()).optional(),
});

export const pipelineSchema = z.looseObject({
  $schema: z.string().optional(),
  id: z.string(),
  description: z.string().optional(),
  outputDir: z.string().optional(),
  /** Decoration for the plain view; a malformed value drops to "no hooks", never fails the pipeline. */
  hooks: hooksSchema.optional().catch(undefined),
  constants: z.record(z.string(), z.unknown()).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  /** The steps the run enters first. More than one means the run starts them in parallel. */
  START: z.array(z.string()),
  steps: z.record(z.string(), pipelineStepSchema),
});

/* ------------------------------------------------------------------ state.json */

export const runStatusSchema = z.enum([
  'IDLE',
  'RUNNING',
  'PAUSED',
  'COMPLETED',
  'FAILED',
  'ABORTED',
]);

export const stepStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'SKIPPED',
  'RETRYING',
]);

/** One finished pass of a step, as the runner records it in the step's own history. */
export const passRecordSchema = z.looseObject({
  pass: z.number().int(),
  event: z.string().nullable().optional(),
  outputs: z.array(z.string()).optional(),
  note: z.string().nullable().optional(),
  startAt: z.string().nullable().optional(),
  endAt: z.string().nullable().optional(),
  durationSeconds: z.number().nullable().optional(),
});

export const stepStateSchema = z.looseObject({
  /** Wave mode: the step's wave. A graph step leaves this at 0. */
  order: z.number().int().default(0),
  kind: z.string().optional(),
  agent: z.string().optional(),
  status: stepStatusSchema,
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  outputs: z.array(z.string()).default([]),
  retryCount: z.number().int().default(0),
  /** Graph mode: how many times the step has been entered. A loop runs it again. */
  passes: z.number().int().optional(),
  /** Graph mode: the event this step returned on its most recent pass. */
  event: z.string().nullable().optional(),
  reported: z.record(z.string(), z.unknown()).optional(),
  note: z.string().nullable().optional(),
  /** Why a SKIPPED step was never run — a caller's reason, or the routing that stranded it. */
  skipReason: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  sessionId: z.string().optional(),
  /** Every finished pass. Older runs have none and the history log is the fallback. */
  history: z.array(passRecordSchema).optional(),
});

/** The run is stopped on a step, waiting for a person to answer. */
export const pauseSchema = z.looseObject({
  step: z.string(),
  status: z.enum(['AWAITING_INPUT', 'RESUMED', 'REJECTED']),
  ask: z.string(),
  capture: z.string().optional(),
  present: z.array(z.string()).optional(),
  pausedAt: z.string().nullable().optional(),
});

export const historyEntrySchema = z.looseObject({
  timestamp: z.string().nullable().optional(),
  type: z.string().optional(),
  message: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const runContextSchema = z.looseObject({
  constants: z.record(z.string(), z.unknown()).default({}),
  params: z.record(z.string(), z.unknown()).default({}),
  captured: z.record(z.string(), z.unknown()).default({}),
});

export const runStateSchema = z.looseObject({
  runId: z.string(),
  pipelineName: z.string(),
  pipelineFile: z.string().optional(),
  status: runStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Wave mode: the wave the run is on. */
  currentWave: z.number().int().optional(),
  /** Wave mode: the steps running right now. */
  activeSteps: z.array(z.string()).default([]),
  /** Graph mode: the steps the graph has routed to that have not finished. */
  frontier: z.array(z.string()).default([]),
  mode: z.string().optional(),
  context: runContextSchema.default({ constants: {}, params: {}, captured: {} }),
  steps: z.record(z.string(), stepStateSchema),
  history: z.array(historyEntrySchema).default([]),
  /** Graph mode: how many times each `step:event` edge has been taken. */
  edges: z.record(z.string(), z.number()).default({}),
  pause: pauseSchema.nullable().optional(),
  vars: z.record(z.string(), z.unknown()).optional(),
});

/* ------------------------------------------------------------------ cost.json */

export const usageTotalsSchema = z.looseObject({
  inputTokens: z.number().default(0),
  cachedInputTokens: z.number().default(0),
  cacheWriteTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  reasoningTokens: z.number().default(0),
  totalTokens: z.number().default(0),
});

export const providerUnitSchema = z.looseObject({
  name: z.string(),
  amount: z.number(),
});

/** Money plus usage for one bucket: the whole run, the orchestrator, a step. */
export const costBucketSchema = z.looseObject({
  requestCount: z.number().default(0),
  totals: usageTotalsSchema.optional(),
  estimatedListPriceUsd: z.number().default(0),
  providerUnits: z.array(providerUnitSchema).default([]),
  /** How much to trust the money: `local-estimate`, `provider-reported`, `unknown`. */
  certainty: z.string().optional(),
  unpricedTokens: z.number().optional(),
});

/** An agent that did work inside a step — the step's own agent, or one it spawned. */
export const costActorSchema = z.looseObject({
  provider: z.string().optional(),
  sessionRunId: z.string().optional(),
  id: z.string().optional(),
  name: z.string().optional(),
  kind: z.string().optional(),
});

export const costStepSchema = z.looseObject({
  step: z.string(),
  order: z.number().int().optional(),
  agent: z.string().nullable().optional(),
  status: z.string().optional(),
  passes: z.number().int().optional(),
  startedAt: z.string().nullable().optional(),
  endedAt: z.string().nullable().optional(),
  durationSeconds: z.number().nullable().optional(),
  /** How the cost was tied to the step: `prompt-ref`, `actor-refs`, `window`… */
  attribution: z.string().optional(),
  actors: z.array(costActorSchema).default([]),
  models: z.array(z.string()).default([]),
  cost: costBucketSchema,
});

export const costSessionSchema = z.looseObject({
  provider: z.string().optional(),
  sessionRunId: z.string().optional(),
  providerSessionId: z.string().optional(),
  linkedBy: z.string().optional(),
  requestCount: z.number().optional(),
});

export const costSchema = z.looseObject({
  /** Written as the string "1" by the current CLI; a number is accepted too. */
  schemaVersion: z.union([z.literal(1), z.literal('1')]),
  generatedAt: z.string(),
  runId: z.string(),
  pipeline: z.string(),
  runDir: z.string().optional(),
  runFolder: z.string().optional(),
  status: z.string().optional(),
  startedAt: z.string().nullable().optional(),
  endedAt: z.string().nullable().optional(),
  durationSeconds: z.number().nullable().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  providers: z.array(z.string()).default([]),
  sessions: z.array(costSessionSchema).default([]),
  totals: costBucketSchema,
  /** The driving conversation itself — everything the harness spent outside a step. */
  orchestrator: costBucketSchema.optional(),
  steps: z.array(costStepSchema).default([]),
  unattributed: costBucketSchema.optional(),
  notes: z.array(z.string()).default([]),
});

/* ------------------------------------------------------------------ payload */

const runRecordBaseSchema = z.looseObject({
  runId: z.string(),
  pipelineId: z.string(),
  dir: z.string(),
  hasState: z.boolean(),
  state: runStateSchema.nullable(),
  /**
   * `<runDir>/cost.json`; null when absent or unreadable. A file that does not match
   * `costSchema` degrades to null here (`.catch`) instead of dropping the whole run —
   * cost is decoration, state is the run.
   */
  cost: costSchema.nullable().optional().catch(null),
  /** The file exists on disk, even when `cost` is null because it could not be read. */
  hasCost: z.boolean().optional(),
  pipeline: pipelineSchema.optional(),
});

/**
 * A run record, with a `state.json` from the older recorder upgraded first (see `legacy.ts`)
 * so those runs validate against the current schema like any other.
 */
export const runRecordSchema = z.preprocess((raw: unknown): unknown => {
  const record = raw as Record<string, unknown> | null;
  if (typeof record !== 'object' || record === null || !isLegacyState(record.state)) return raw;
  return { ...record, state: upgradeLegacyState(record.state, String(record.runId ?? '')) };
}, runRecordBaseSchema);

export const dashboardDataSchema = z.looseObject({
  generatedAt: z.string(),
  pipelines: z.record(z.string(), pipelineSchema),
  runs: z.array(runRecordSchema),
});

/** The live payload's envelope with runs left unparsed, so each run can be validated on its own. */
export const dashboardEnvelopeSchema = z.looseObject({
  generatedAt: z.string(),
  pipelines: z.record(z.string(), pipelineSchema),
  runs: z.array(z.unknown()),
});

export type ParseIssue = { path: string; message: string };

/** The first few issues of a failed parse as plain strings for an error screen. */
export const describeIssues = (error: z.ZodError, limit: number = 5): ParseIssue[] =>
  error.issues.slice(0, limit).map((i): ParseIssue => ({
    path: i.path.map(String).join('.') || '(root)',
    message: i.message,
  }));
