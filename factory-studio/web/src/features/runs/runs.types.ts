export type { DashboardData, RunRecord, Pipeline, RunState, Cost } from './lib/types';
import type { z } from 'zod';
import type { Attempt } from './lib/attempts';
import type { RunRecord } from './lib/types';
import type { removedRunSchema } from './runs.schema';

/** E15's answer: the run that went, and where (`run/.trash/<folder>/<runId>-<stamp>`). */
export type RemovedRun = z.infer<typeof removedRunSchema>['removed'];

/** How one remove ended, as the table shows it. */
export type RemoveRunOutcome =
  | { ok: true; removed: RemovedRun }
  /** `live`: a session is still in the run (409); the message is the API's own. */
  | { ok: false; live: boolean; message: string };

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
  /** CSS custom property carrying the status colour (`--st-pending` for a run without state). */
  statusToken: string;
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
  /** The state says RUNNING or PAUSED: live, or dead if its session is gone. */
  active: boolean;
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

/** One step on the run page's Timeline tab, in the order the run reached it. */
export interface TimelineRow {
  slug: string;
  /** When the step's first recorded pass started; null when it never ran (or ran without timestamps). */
  startedAt: string | null;
  /** How many times the step was entered: 2 for a step a loop sent back once. */
  passes: number;
  /**
   * The passes the state has timings for, oldest first: every one when it kept a history,
   * only the latest when it kept just the step's own timestamps.
   */
  attempts: Attempt[];
  /** Its first pass started before the row above finished: the two ran side by side. */
  parallel: boolean;
  /** The step was started at least once; false for a pending or skipped one. */
  ran: boolean;
  /** Why a skipped step never ran, as the state recorded it. */
  skipReason: string | null;
}

/** A piece of a hook command: plain text, or a script path that opens in the viewer. */
export interface HookSegment {
  text: string;
  /** Where the chip opens, when this piece is a path token that resolves to a file or folder. */
  target: HookTarget | null;
}

/**
 * A path in a hook command, resolved the way the runner substitutes it: a file of the run
 * folder (`run`, the path relative to it) or a file under the studio's work dir (`knowledge`,
 * the `{{rootPath}}/…` form the knowledge endpoint expands and guards).
 */
export interface HookTarget {
  scope: 'run' | 'knowledge';
  path: string;
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
