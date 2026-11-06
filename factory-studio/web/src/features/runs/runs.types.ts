export type { DashboardData, RunRecord, Pipeline, RunState, Cost } from './lib/types';
import type { z } from 'zod';
import type { Attempt } from './lib/attempts';
import type { RunRecord, StepStatus } from './lib/types';
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

/** One line of a run's per-step breakdown (the expanded row of the run table). */
export interface StepUsageRow {
  /** The step slug; `Total` and the "other" line use their own names. */
  step: string;
  status: StepStatus | null;
  /** Times the step was entered; `null` when it never started. */
  passes: number | null;
  /** Tokens the report tied to the step; `null` when nothing was billed against it. */
  tokens: number | null;
  /** Money; `unpriced` when tokens were counted but no price is known; `null` when nothing was billed. */
  costUsd: number | 'unpriced' | null;
  /** Working time of its passes (an open pass counted to now); `null` when it never started. */
  durationSeconds: number | null;
  /** A human gate's time waiting for a person (not running time); `null` for agent steps. */
  waitSeconds: number | null;
  /** When it first started, for the order; `null` when it never did. */
  startedMs: number | null;
  /** The models that did the row's work, most tokens first; empty when nothing was billed. */
  models: StepModelUsage[];
}

/** One model's share of a breakdown row, from the report's usage records. */
export interface StepModelUsage {
  /** The provider's model id, e.g. `claude-opus-5-5`. */
  model: string;
  tokens: number;
  /** `null` when the report priced none of this model's tokens. */
  costUsd: number | null;
}

export interface StepBreakdown {
  /** In start order; steps that never started last, in the pipeline's order. */
  steps: StepUsageRow[];
  /** Usage the report holds outside any step (the orchestrator, unattributed calls); `null` when none. */
  other: StepUsageRow | null;
  /** The run's own tokens and cost (the run row's figures), and the passes summed. */
  total: StepUsageRow;
  /** The run has a cost.json at all. */
  priced: boolean;
}

/** A pipeline's runs averaged: each figure over the runs that carry it; `null` when none does. */
export interface PipelineAverages {
  costUsd: number | null;
  totalTokens: number | null;
  durationSeconds: number | null;
}

/** The longest bar of each kind on the runs list: every card's bars are a share of these. */
export interface RunScale {
  costUsd: number;
  totalTokens: number;
  durationSeconds: number;
}

/** One step line of the run panel with its share of the run's money, as the bar draws it. */
export interface StepShare {
  row: StepUsageRow;
  /** The row's money over the run's total, 0..1; `null` when the row has no money. */
  share: number | null;
  /** Bar length, 0..100, against the costliest row. */
  barPct: number;
  /** Among the costliest rows (at least half of the top one): drawn in the warm colour. */
  hot: boolean;
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
