export type { DashboardData, RunRecord, Pipeline, RunState, Cost } from './lib/types';
import type { RunRecord } from './lib/types';

/** One row of the per-pipeline table: sums over every run of that pipeline. */
export interface PipelineOverview {
  pipelineId: string;
  runs: number;
  steps: number;
  /** `null` when no run of the pipeline carries a cost.json. */
  costUsd: number | null;
  totalTokens: number | null;
  durationSeconds: number | null;
  /** Newest `createdAt` among the runs, or `null` when none has state. */
  lastRunAt: string | null;
  /** Runs without a cost.json. */
  unpriced: number;
}

/** One row of the per-run table, computed in the browser from a `RunRecord`. */
export interface RunOverview {
  pipelineId: string;
  runId: string;
  /** The run status word, or `no state` for a run without state.json. */
  status: string;
  steps: number;
  stepsCompleted: number;
  stepsSkipped: number;
  stepsFailed: number;
  costUsd: number | null;
  totalTokens: number | null;
  durationSeconds: number | null;
  startedAt: string | null;
  priced: boolean;
  hasState: boolean;
}

export interface OverviewTotals {
  pipelines: number;
  runs: number;
  steps: number;
  costUsd: number;
  totalTokens: number;
  unpricedRuns: number;
}

export interface Overview {
  pipelines: PipelineOverview[];
  runs: RunOverview[];
  totals: OverviewTotals;
}

/** One route of a step as the plain view prints it, with what the run did along it. */
export interface PlainTransition {
  event: string;
  targets: string[];
  /** Times the run returned this event (the state's `edges` counter). */
  taken: number;
  max: number | null;
  onMax: string[];
  /** Times the cap was spent and the run went to `onMax` instead. */
  onMaxTaken: number;
}

/** A piece of a hook command: plain text, or a script path that opens in the viewer. */
export interface HookSegment {
  text: string;
  /** The path under `scripts/`, when this piece names a script. */
  script: string | null;
}

/** The runs of one pipeline, in the order the list had them. */
export interface RunGroup {
  pipelineId: string;
  runs: RunRecord[];
}

/** The sidebar's status chips: `running` covers a run waiting on a person too. */
export type RunFilter = 'all' | 'running' | 'completed' | 'failed';

/** The runs that started on one day (`Today`, `Yesterday`, `Oct 3`), in the order the list had them. */
export interface DayGroup {
  label: string;
  runs: RunRecord[];
}
