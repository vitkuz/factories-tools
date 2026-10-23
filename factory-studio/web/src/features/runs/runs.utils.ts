import { RUN_STATUS_META, runStatusWord } from './lib/run';
import { attemptSpanMs, attemptsOf, type Attempt } from './lib/attempts';
import { formatDay, formatDurationMs, formatTokens } from './lib/format';
import type { StepStatusKey } from './lib/graph';
import { END_ID } from '../../shared/graph';
import { describeApiError, isApiError } from '../../adapters/http/api-error.utils';
import type { PipelineStep, RunState, StepState } from './lib/types';
import type {
  DashboardData,
  DayGroup,
  Overview,
  OverviewTotals,
  PipelineOverview,
  PlainTransition,
  RunFilter,
  RunGroup,
  RunOverview,
  RemoveRunOutcome,
  RemovedRun,
  RunRecord,
  TimelineRow,
} from './runs.types';

/** Groups in first-seen order, so the list reads like the run/ folder. */
export const groupByPipeline = (runs: RunRecord[]): RunGroup[] =>
  runs.reduce((acc: RunGroup[], run: RunRecord): RunGroup[] => {
    const existing: RunGroup | undefined = acc.find((g) => g.pipelineId === run.pipelineId);
    return existing
      ? acc.map((g) => (g === existing ? { ...g, runs: [...g.runs, run] } : g))
      : [...acc, { pipelineId: run.pipelineId, runs: [run] }];
  }, []);

/**
 * A step output as a path inside its run folder. Some recorders store it from the repo root
 * (`run/<pipeline>/<run>/3-write-report/x.md`); the API wants `3-write-report/x.md`.
 */
export const runRelativePath = (
  run: Pick<RunRecord, 'pipelineId' | 'runId'>,
  path: string,
): string => {
  const prefix: string = `run/${run.pipelineId}/${run.runId}/`;
  const trimmed: string = path.replace(/^\.\//, '');
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : path;
};

export const isActiveRun = (run: RunRecord | undefined): boolean =>
  run?.state?.status === 'RUNNING' || run?.state?.status === 'PAUSED';

const parseMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms: number = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
};

/** Wall-clock seconds from `createdAt` to `updatedAt`, or to `now` while the run is moving. */
export const runDurationSeconds = (run: RunRecord, now: number): number | null => {
  const start: number | null = parseMs(run.state?.createdAt);
  if (start === null) return null;
  const end: number | null = isActiveRun(run) ? now : parseMs(run.state?.updatedAt);
  if (end === null || end < start) return null;
  return Math.round((end - start) / 1000);
};

const countStatus = (run: RunRecord, status: string): number =>
  Object.values(run.state?.steps ?? {}).filter((s) => s.status === status).length;

/** One row of the per-run table, from the record alone. */
export const runOverviewOf = (run: RunRecord, now: number): RunOverview => ({
  pipelineId: run.pipelineId,
  runId: run.runId,
  status: run.state ? runStatusWord(run.state.status) : 'no state',
  statusToken: run.state ? RUN_STATUS_META[run.state.status].token : '--st-pending',
  steps: Object.keys(run.state?.steps ?? {}).length,
  stepsCompleted: countStatus(run, 'COMPLETED'),
  stepsSkipped: countStatus(run, 'SKIPPED'),
  stepsFailed: countStatus(run, 'FAILED'),
  costUsd: run.cost ? run.cost.totals.estimatedListPriceUsd : null,
  totalTokens: run.cost?.totals.totals?.totalTokens ?? null,
  durationSeconds: runDurationSeconds(run, now),
  startedAt: run.state?.createdAt ?? null,
  priced: run.cost !== null && run.cost !== undefined,
  hasState: run.hasState,
  active: isActiveRun(run),
});

const sumOrNull = (values: (number | null)[]): number | null => {
  const known: number[] = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : known.reduce((a: number, b: number): number => a + b, 0);
};

const newest = (values: (string | null)[]): string | null =>
  values
    .filter((v): v is string => v !== null)
    .sort((a: string, b: string): number => Date.parse(b) - Date.parse(a))[0] ?? null;

/** One row of the per-pipeline table: sums over the group. */
export const pipelineOverviewOf = (group: RunGroup, now: number): PipelineOverview => {
  const rows: RunOverview[] = group.runs.map((run: RunRecord): RunOverview =>
    runOverviewOf(run, now),
  );
  return {
    pipelineId: group.pipelineId,
    runs: rows.length,
    steps: rows.reduce((n: number, r: RunOverview): number => n + r.steps, 0),
    costUsd: sumOrNull(rows.map((r: RunOverview): number | null => r.costUsd)),
    totalTokens: sumOrNull(rows.map((r: RunOverview): number | null => r.totalTokens)),
    durationSeconds: sumOrNull(rows.map((r: RunOverview): number | null => r.durationSeconds)),
    lastRunAt: newest(rows.map((r: RunOverview): string | null => r.startedAt)),
    unpriced: rows.filter((r: RunOverview): boolean => !r.priced).length,
  };
};

/** The two tables and the totals above them, all from the run list. */
export const overviewOf = (data: DashboardData, now: number): Overview => {
  const groups: RunGroup[] = groupByPipeline(data.runs);
  const pipelines: PipelineOverview[] = groups.map((g: RunGroup): PipelineOverview =>
    pipelineOverviewOf(g, now),
  );
  const runs: RunOverview[] = data.runs.map((run: RunRecord): RunOverview =>
    runOverviewOf(run, now),
  );
  const totals: OverviewTotals = {
    pipelines: pipelines.length,
    runs: runs.length,
    steps: runs.reduce((n: number, r: RunOverview): number => n + r.steps, 0),
    costUsd: runs.reduce((n: number, r: RunOverview): number => n + (r.costUsd ?? 0), 0),
    totalTokens: runs.reduce((n: number, r: RunOverview): number => n + (r.totalTokens ?? 0), 0),
    unpricedRuns: runs.filter((r: RunOverview): boolean => !r.priced).length,
  };
  return { pipelines, runs, totals };
};

/* ------------------------------------------------------------------ runs home */

/** Newest first; an undated pipeline sorts after every dated one (no Infinity arithmetic). */
const byLastRun = (a: PipelineOverview, b: PipelineOverview): number => {
  const left: number | null = parseMs(a.lastRunAt);
  const right: number | null = parseMs(b.lastRunAt);
  if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
  return right - left;
};

/** Pipelines newest last run first; a pipeline with no dated run goes last, list order kept on ties. */
export const sortByLastRun = (pipelines: readonly PipelineOverview[]): PipelineOverview[] =>
  [...pipelines].sort(byLastRun);

/** The pipeline the home shows: the one asked for while it is listed, else the first one. */
export const pickPipeline =
  (wanted: string | null) =>
  (pipelines: readonly PipelineOverview[]): PipelineOverview | null =>
    pipelines.find((p: PipelineOverview): boolean => p.pipelineId === wanted) ??
    pipelines[0] ??
    null;

/** The rows of one pipeline, in the order the list had them (newest first). */
export const runsOfPipeline =
  (pipelineId: string) =>
  (runs: readonly RunOverview[]): RunOverview[] =>
    runs.filter((run: RunOverview): boolean => run.pipelineId === pipelineId);

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "6 runs · 112 steps · 486.6M tok": the second line of a pipeline row; no tokens part without a cost.json. */
export const pipelineSummary = (pipeline: PipelineOverview): string =>
  [
    plural(pipeline.runs, 'run'),
    plural(pipeline.steps, 'step'),
    pipeline.totalTokens === null ? null : `${formatTokens(pipeline.totalTokens)} tok`,
  ]
    .filter((part: string | null): part is string => part !== null)
    .join(' · ');

/** Absent is not zero: a pipeline whose every run lacks a cost.json has no cost to state. */
export const isAllUnpriced = (pipeline: PipelineOverview): boolean =>
  pipeline.runs > 0 && pipeline.unpriced === pipeline.runs;

const startOfDay = (ms: number): number => {
  const d: Date = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "Today", "Yesterday", else "Oct 3" — the sidebar's label for a run's start day; "No state" without one. */
export const dayLabel = (iso: string | null | undefined, now: number): string => {
  const ms: number | null = parseMs(iso);
  if (ms === null) return 'No state';
  const today: number = startOfDay(now);
  const day: number = startOfDay(ms);
  if (day === today) return 'Today';
  if (day === startOfDay(today - 1)) return 'Yesterday';
  return formatDay(iso);
};

/** Runs in list order, bucketed by start day; the API lists newest first, stateless runs last. */
export const groupByDay = (runs: RunRecord[], now: number): DayGroup[] =>
  runs.reduce((acc: DayGroup[], run: RunRecord): DayGroup[] => {
    const label: string = dayLabel(run.state?.createdAt, now);
    const existing: DayGroup | undefined = acc.find((g) => g.label === label);
    return existing
      ? acc.map((g) => (g === existing ? { ...g, runs: [...g.runs, run] } : g))
      : [...acc, { label, runs: [run] }];
  }, []);

/** The sidebar's status chips: `running` is a run that is moving or waiting on a person. */
export const matchesFilter =
  (filter: RunFilter) =>
  (run: RunRecord): boolean => {
    const status: string | undefined = run.state?.status;
    switch (filter) {
      case 'all':
        return true;
      case 'running':
        return status === 'RUNNING' || status === 'PAUSED';
      case 'completed':
        return status === 'COMPLETED';
      case 'failed':
        return status === 'FAILED' || status === 'ABORTED';
    }
  };

/** A case-insensitive substring match on the run id or its pipeline; an empty query matches all. */
export const matchesQuery =
  (query: string) =>
  (run: RunRecord): boolean => {
    const q: string = query.trim().toLowerCase();
    return (
      q === '' || run.runId.toLowerCase().includes(q) || run.pipelineId.toLowerCase().includes(q)
    );
  };

/**
 * The run id as the sidebar prints it: without a trailing `-YYYY-MM-DD`, because the day is
 * the group it sits under. The full id stays in the row's `title` and in the header.
 */
export const displayRunId = (runId: string): string => runId.replace(/-\d{4}-\d{2}-\d{2}$/, '');

/* ------------------------------------------------------------------ plain view */

const SENTENCE_MAX = 160;

/** The first sentence of a prompt (its first line, cut at `. ` / `! ` / `? `), capped in length. */
export const firstSentence = (text: string): string => {
  const line: string = text.trim().split('\n')[0] ?? '';
  const match: RegExpMatchArray | null = line.match(/^.*?[.!?](?=\s|$)/);
  const sentence: string = (match ? match[0] : line).trim();
  return sentence.length > SENTENCE_MAX ? `${sentence.slice(0, SENTENCE_MAX - 1)}…` : sentence;
};

export interface PromptPreview {
  /** The collapsed line: the text's first sentence, capped. */
  preview: string;
  /** The full text, trimmed, shown when expanded. */
  full: string;
  /** More than the preview to show: the toggle only appears then. */
  expandable: boolean;
}

/** Splits a prompt into its collapsed preview line and its full text. */
export const promptPreview = (text: string): PromptPreview => {
  const full: string = text.trim();
  const preview: string = firstSentence(full);
  return { preview, full, expandable: full !== preview };
};

export const isGlobPath = (path: string): boolean => /[*?]/.test(path);

const escapeRegExp = (text: string): string => text.replace(/[.+^${}()|[\]\\]/g, '\\$&');

/** `6-answer-questions/*.md` → a regex: `*` is anything but `/`, `**` anything, `?` one character. */
export const globToRegExp = (glob: string): RegExp =>
  new RegExp(
    `^${glob
      .split('**')
      .map((deep: string): string =>
        deep
          .split('*')
          .map((part: string): string => part.split('?').map(escapeRegExp).join('[^/]'))
          .join('[^/]*'),
      )
      .join('.*')}$`,
  );

/**
 * A glob in a step's input/output list, resolved to the files the run actually wrote; a
 * plain path is itself, and a glob nothing matched stays as written (pure, curried).
 */
export const expandGlob =
  (candidates: readonly string[]) =>
  (pattern: string): string[] => {
    if (!isGlobPath(pattern)) return [pattern];
    const re: RegExp = globToRegExp(pattern);
    const matches: string[] = candidates.filter((c: string): boolean => re.test(c));
    return matches.length > 0 ? matches : [pattern];
  };

/** Every output any step of the run recorded, relative to the run folder, each once. */
export const recordedOutputs = (run: RunRecord): string[] => [
  ...new Set(
    Object.values(run.state?.steps ?? {})
      .flatMap((s): string[] => s.outputs)
      .map((p: string): string => runRelativePath(run, p)),
  ),
];

/** A doc list with its globs expanded against what the run wrote, in order, each once. */
export const expandDocs =
  (candidates: readonly string[]) =>
  (paths: readonly string[]): string[] => [...new Set(paths.flatMap(expandGlob(candidates)))];

/** The routes of a step, with the state's `"<step>:<EVENT>"` counters split over target and `onMax`. */
export const transitionsOf = (
  slug: string,
  step: PipelineStep,
  state: RunState | null,
): PlainTransition[] =>
  Object.entries(step.transitions).map(([event, route]): PlainTransition => {
    const count: number = state?.edges[`${slug}:${event}`] ?? 0;
    const max: number | null = route.max ?? null;
    return {
      event,
      targets: route.target,
      taken: max === null ? count : Math.min(count, max),
      max,
      onMax: route.onMax ?? [],
      onMaxTaken: max === null ? 0 : Math.max(0, count - max),
    };
  });

/* ------------------------------------------------------------------ timeline */

const STARTED: ReadonlySet<string> = new Set(['RUNNING', 'RETRYING', 'COMPLETED', 'FAILED']);

const msOf = (iso: string | null | undefined): number | null => {
  const ms: number = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
};

/** When an attempt list ends: its last finish, or `now` while one is still open. */
const lastEndMs = (attempts: readonly Attempt[], now: number): number | null =>
  attempts.reduce((end: number | null, a: Attempt): number | null => {
    const start: number | null = msOf(a.startedAt);
    const span: number | null = attemptSpanMs(a, now);
    if (start === null || span === null) return end;
    return Math.max(end ?? 0, start + span);
  }, null);

/** One step's row before it is placed (curried over the state). */
const timelineRow =
  (state: RunState | null) =>
  (slug: string): TimelineRow => {
    const st: StepState | undefined = state?.steps?.[slug];
    const attempts: Attempt[] = attemptsOf(state)(slug);
    const first: Attempt | undefined = attempts.find((a: Attempt): boolean => a.startedAt !== null);
    const startedAt: string | null = first?.startedAt ?? null;
    return {
      slug,
      startedAt,
      passes: Math.max(st?.passes ?? 0, attempts.length, startedAt !== null ? 1 : 0),
      attempts,
      parallel: false,
      ran: startedAt !== null || (st !== undefined && STARTED.has(st.status)),
      skipReason: st?.skipReason ?? null,
    };
  };

/**
 * The steps in the order the run reached them: every step with a start time by its first
 * start (the graph order breaks ties), then the ones without — never run, skipped, or run
 * before the recorder kept timestamps — in the graph order. A row whose first start falls
 * before the row above finished is flagged `parallel` (pure, curried).
 */
export const timelineRows =
  (state: RunState | null, now: number) =>
  (order: readonly string[]): TimelineRow[] => {
    const rows: TimelineRow[] = order.map(timelineRow(state));
    const timed: TimelineRow[] = rows
      .filter((r: TimelineRow): boolean => msOf(r.startedAt) !== null)
      .sort(
        (a: TimelineRow, b: TimelineRow): number =>
          (msOf(a.startedAt) ?? 0) - (msOf(b.startedAt) ?? 0),
      );
    const untimed: TimelineRow[] = rows.filter(
      (r: TimelineRow): boolean => msOf(r.startedAt) === null,
    );
    return [
      ...timed.map((row: TimelineRow, i: number): TimelineRow => {
        const prev: TimelineRow | undefined = timed[i - 1];
        const prevEnd: number | null = prev ? lastEndMs(prev.attempts, now) : null;
        const start: number | null = msOf(row.startedAt);
        return prevEnd !== null && start !== null && start < prevEnd
          ? { ...row, parallel: true }
          : row;
      }),
      ...untimed,
    ];
  };

/** What a step's time cell needs from its card data. */
export interface StepTiming {
  status: StepStatusKey;
  human: boolean;
  workingMs: number | null;
  attemptCount: number;
  waitedMs: number | null;
}

/**
 * The time cell of a step: `skipped`, `waiting for you`, `waited 4 min`, `running`, `2 min`,
 * `5 min ×3` over a loop whose passes were all timed, `last pass 40 s` when the step ran
 * more often than the state kept timings for; '' when there is nothing to say.
 */
export const stepTimeLabel =
  (passes: number) =>
  (t: StepTiming): string => {
    if (t.status === 'SKIPPED') return 'skipped';
    if (t.status === 'waiting') return 'waiting for you';
    if (t.status === 'none' || t.status === 'PENDING') return '';
    if (t.human) return t.waitedMs === null ? '' : `waited ${formatDurationMs(t.waitedMs)}`;
    if (t.workingMs === null) return t.status === 'RUNNING' ? 'running' : '';
    const total: string = formatDurationMs(t.workingMs);
    if (t.attemptCount > 1) return `${total} ×${t.attemptCount}`;
    return passes > 1 ? `last pass ${total}` : total;
  };

/** What a transition target jumps to: a step's card, the END marker, or nowhere. */
export type JumpKind = 'step' | 'end' | 'none';

/** Classifies a transition target against the steps that have a card in the Timeline (pure, curried). */
export const jumpKindOf =
  (stepSlugs: readonly string[]) =>
  (name: string): JumpKind =>
    name === END_ID ? 'end' : stepSlugs.includes(name) ? 'step' : 'none';

/* ---------------------------------------------------------------- remove a run */

/** A failed remove as the confirm shows it: a 409 is a live session, its message the API's. */
export const removeFailureOf = (error: unknown): RemoveRunOutcome => {
  if (!isApiError(error))
    return {
      ok: false,
      live: false,
      message: error instanceof Error ? error.message : String(error),
    };
  return {
    ok: false,
    live: error.kind === 'http' && error.status === 409,
    message: describeApiError(error),
  };
};

/** The line after a remove: what went where, and how to bring it back. */
export const removedNotice = (removed: RemovedRun): string =>
  `Moved ${removed.runId} to ${removed.trashedTo}. To restore it, move that folder back to ${removed.from}.`;
