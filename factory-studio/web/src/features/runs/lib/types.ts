import type { z } from 'zod';
import type {
  costActorSchema,
  costBucketSchema,
  costSchema,
  costSessionSchema,
  costStepSchema,
  dashboardDataSchema,
  historyEntrySchema,
  passRecordSchema,
  pauseSchema,
  pipelineSchema,
  pipelineStepSchema,
  routeSchema,
  runContextSchema,
  runRecordSchema,
  runStateSchema,
  runStatusSchema,
  stepStateSchema,
  stepStatusSchema,
  usageTotalsSchema,
} from './dashboard.schema';

// Types are inferred from the Zod schemas in dashboard.schema.ts (one source of truth),
// which are this factory's own pipeline.json, state.json and cost.json formats.

export type Route = z.infer<typeof routeSchema>;
export type PipelineStep = z.infer<typeof pipelineStepSchema>;
export type Pipeline = z.infer<typeof pipelineSchema>;

export type StepStatus = z.infer<typeof stepStatusSchema>;
export type StepState = z.infer<typeof stepStateSchema>;
export type PassRecord = z.infer<typeof passRecordSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type Pause = z.infer<typeof pauseSchema>;
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
export type RunContext = z.infer<typeof runContextSchema>;
export type RunState = z.infer<typeof runStateSchema>;

export type RunRecord = z.infer<typeof runRecordSchema>;
export type DashboardData = z.infer<typeof dashboardDataSchema>;

export type Cost = z.infer<typeof costSchema>;
export type CostBucket = z.infer<typeof costBucketSchema>;
export type CostStep = z.infer<typeof costStepSchema>;
export type CostActor = z.infer<typeof costActorSchema>;
export type CostSession = z.infer<typeof costSessionSchema>;
export type UsageTotals = z.infer<typeof usageTotalsSchema>;

/** Where the data currently on screen came from. */
export type DataSource = 'live' | 'unreachable';
