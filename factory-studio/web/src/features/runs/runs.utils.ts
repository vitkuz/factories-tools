import { runStatusWord } from './lib/run';
import { formatDay } from './lib/format';
import type { PipelineStep, RunState } from './lib/types';
import type {
  DashboardData,
  DayGroup,
  HookSegment,
  Overview,
  OverviewTotals,
  PipelineOverview,
  PlainTransition,
  RunFilter,
  RunGroup,
  RunOverview,
  RunRecord,
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

/** A script path inside a hook command: `scripts/x.sh`, with or without a `{{rootPath}}/` or `./` in front. */
const HOOK_SCRIPT =
  /(?:\{\{rootPath\}\}\/|\.\/)?scripts\/[\w./-]*\.(?:sh|bash|mjs|cjs|js|ts|py)\b/g;

/** A hook command split into text and the script paths it names (relative to `scripts/`). */
export const hookSegments = (command: string): HookSegment[] => {
  const segments: HookSegment[] = [];
  const push = (text: string, script: string | null): void => {
    if (text !== '') segments.push({ text, script });
  };
  const end: number = [...command.matchAll(HOOK_SCRIPT)].reduce(
    (from: number, match: RegExpMatchArray): number => {
      const at: number = match.index ?? from;
      push(command.slice(from, at), null);
      push(match[0], match[0].replace(/^.*?scripts\//, ''));
      return at + match[0].length;
    },
    0,
  );
  push(command.slice(end), null);
  return segments;
};
