import type { ZodSafeParseResult } from 'zod';
import type { SocketState } from '../../shared/lib/use-websocket';
import type { RunRef } from '../../shared/lib/route';
import type { ServerMessage } from '../sessions/sessions.types';
import type { DataSource } from './lib/types';
import {
  dashboardEnvelopeSchema,
  describeIssues,
  runRecordSchema,
  type ParseIssue,
} from './runs.schema';
import type { DashboardData, Pipeline, RunRecord } from './runs.types';

/*
 * The run list as the socket feeds it: pure functions over the frames of the `runs` topic.
 * `reduceRunsFeed` is the one place the data on screen changes; the hook only dispatches.
 */

export const EMPTY_DATA: DashboardData = {
  generatedAt: new Date(0).toISOString(),
  pipelines: {},
  runs: [],
};

export interface RunsFeedState {
  data: DashboardData;
  source: DataSource;
  /** A snapshot has arrived since the socket opened: the run list is as complete as it gets for now. */
  settled: boolean;
  /** The last snapshot failed validation as a whole; the previous data is still on screen. */
  invalid: boolean;
  /** The first issues of the last invalid snapshot, for the error screen. */
  invalidIssues: ParseIssue[];
  /** Runs (`pipelineId/runId`, or `#index`) whose record was invalid and is hidden. */
  dropped: string[];
}

export const initialRunsFeedState: RunsFeedState = {
  data: EMPTY_DATA,
  source: 'unreachable',
  settled: false,
  invalid: false,
  invalidIssues: [],
  dropped: [],
};

export type RunsFeedAction =
  | { kind: 'message'; message: ServerMessage }
  | { kind: 'connection'; state: SocketState }
  /** Drop one run from the data on screen now (it was removed); the server's own frame confirms it. */
  | { kind: 'forget'; ref: RunRef };

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const runKey = (r: RunRecord): string => `${r.pipelineId}/${r.runId}`;

/** The data without one run; the same object when the run is not in it. */
export const withoutRun = (data: DashboardData, ref: RunRef): DashboardData => {
  const runs: RunRecord[] = data.runs.filter(
    (r: RunRecord): boolean => !(r.pipelineId === ref.pipelineId && r.runId === ref.runId),
  );
  return runs.length === data.runs.length ? data : { ...data, runs };
};

/** Reuse unchanged run and pipeline objects from `prev`; return `prev` itself if nothing moved. */
export const mergeStable = (prev: DashboardData, next: DashboardData): DashboardData => {
  const pipelines: Record<string, Pipeline> = Object.fromEntries(
    Object.entries(next.pipelines).map(([id, p]: [string, Pipeline]): [string, Pipeline] => {
      const old: Pipeline | undefined = prev.pipelines[id];
      return [id, old && sameJson(old, p) ? old : p];
    }),
  );
  const prevRuns: Map<string, RunRecord> = new Map(prev.runs.map((r) => [runKey(r), r]));
  const runs: RunRecord[] = next.runs.map((r: RunRecord): RunRecord => {
    const old: RunRecord | undefined = prevRuns.get(runKey(r));
    return old && sameJson(old, r) ? old : r;
  });

  const unchanged: boolean =
    runs.length === prev.runs.length &&
    runs.every((r, i) => r === prev.runs[i]) &&
    Object.keys(pipelines).length === Object.keys(prev.pipelines).length &&
    Object.entries(pipelines).every(([id, p]) => prev.pipelines[id] === p);

  return unchanged ? prev : { generatedAt: next.generatedAt, pipelines, runs };
};

/** `state.createdAt` when the run has one, else `''`. */
const runCreatedAt = (record: RunRecord): string => record.state?.createdAt ?? '';

/** Newest `createdAt` first, stateful before stateless, then by run id — the API's own order. Pure. */
export const sortRuns = (runs: readonly RunRecord[]): RunRecord[] =>
  [...runs].sort((a: RunRecord, b: RunRecord): number => {
    const at: string = runCreatedAt(a);
    const bt: string = runCreatedAt(b);
    if (at !== '' && bt !== '' && at !== bt) return bt.localeCompare(at);
    if (at !== '' && bt === '') return -1;
    if (at === '' && bt !== '') return 1;
    return a.runId.localeCompare(b.runId);
  });

interface FetchOk {
  kind: 'ok';
  data: DashboardData;
  dropped: string[];
}
interface FetchInvalid {
  kind: 'invalid';
  message: string;
  issues: ParseIssue[];
}
export type SnapshotOutcome = FetchOk | FetchInvalid;

/** A readable name for an invalid run record, for the footer note. */
const runName = (raw: unknown, index: number): string => {
  const r = raw as { pipelineId?: unknown; runId?: unknown } | null;
  return typeof r?.pipelineId === 'string' && typeof r?.runId === 'string'
    ? `${r.pipelineId}/${r.runId}`
    : `#${index + 1}`;
};

/**
 * Validate a payload run by run: one half-written `state.json` hides that run (named in
 * `dropped`) instead of freezing every other run on screen.
 */
export const parseLivePayload = (body: unknown): SnapshotOutcome => {
  const envelope = dashboardEnvelopeSchema.safeParse(body);
  if (!envelope.success)
    return {
      kind: 'invalid',
      message: envelope.error.issues[0]?.message ?? 'unexpected payload shape',
      issues: describeIssues(envelope.error),
    };
  const runs: RunRecord[] = [];
  const dropped: string[] = [];
  envelope.data.runs.forEach((raw: unknown, i: number): void => {
    const parsed = runRecordSchema.safeParse(raw);
    if (parsed.success) runs.push(parsed.data);
    else dropped.push(runName(raw, i));
  });
  if (runs.length === 0 && dropped.length > 0)
    return {
      kind: 'invalid',
      message: 'every run record is invalid',
      issues: dropped.map((name: string): ParseIssue => ({
        path: name,
        message: 'invalid run record',
      })),
    };
  const { generatedAt, pipelines } = envelope.data;
  return { kind: 'ok', data: { generatedAt, pipelines, runs }, dropped };
};

type RunChanged = Extract<ServerMessage, { type: 'run.changed' }>;

/** The runs without the one the frame names: filed under `folder`, or declaring `pipelineId`. */
const dropNamed = (runs: readonly RunRecord[], change: RunChanged): RunRecord[] =>
  runs.filter(
    (r: RunRecord): boolean =>
      !(
        r.runId === change.runId &&
        (r.pipelineId === change.folder || r.pipelineId === change.pipelineId)
      ),
  );

const without = (list: readonly string[], name: string): string[] =>
  list.filter((n: string): boolean => n !== name);

/** One `run.changed` frame applied: the run replaced, removed, or (files only) nothing. */
const applyRunChanged = (state: RunsFeedState, change: RunChanged): RunsFeedState => {
  if (change.run === undefined) return state;
  const name: string = `${change.pipelineId ?? change.folder}/${change.runId}`;
  const rest: RunRecord[] = dropNamed(state.data.runs, change);
  if (change.run === null) {
    const dropped: string[] =
      change.reason === 'unreadable'
        ? [...without(state.dropped, name), name]
        : without(state.dropped, name);
    return rest.length === state.data.runs.length && dropped.length === state.dropped.length
      ? state
      : { ...state, data: { ...state.data, runs: rest }, dropped };
  }
  const parsed: ZodSafeParseResult<RunRecord> = runRecordSchema.safeParse(change.run);
  if (!parsed.success) {
    return {
      ...state,
      data: { ...state.data, runs: rest },
      dropped: [...without(state.dropped, name), name],
    };
  }
  const old: RunRecord | undefined = state.data.runs.find(
    (r: RunRecord): boolean => runKey(r) === runKey(parsed.data),
  );
  const next: RunRecord = old !== undefined && sameJson(old, parsed.data) ? old : parsed.data;
  if (next === old && rest.length === state.data.runs.length - 1 && !state.dropped.includes(name))
    return state;
  return {
    ...state,
    data: { ...state.data, runs: sortRuns([...rest, next]) },
    dropped: without(state.dropped, name),
  };
};

const applySnapshot = (state: RunsFeedState, body: unknown): RunsFeedState => {
  const outcome: SnapshotOutcome = parseLivePayload(body);
  if (outcome.kind === 'ok') {
    return {
      data: mergeStable(state.data, outcome.data),
      source: 'live',
      settled: true,
      invalid: false,
      invalidIssues: [],
      dropped: outcome.dropped,
    };
  }
  // A half-written state.json or a schema drift: keep what is on screen, say so.
  return { ...state, settled: true, invalid: true, invalidIssues: outcome.issues };
};

const applyPipelines = (
  state: RunsFeedState,
  pipelines: Record<string, Pipeline>,
): RunsFeedState => {
  const merged: DashboardData = mergeStable(state.data, { ...state.data, pipelines });
  return merged === state.data ? state : { ...state, data: merged };
};

/** Pure reducer of the `runs` topic and the socket's state. */
export const reduceRunsFeed = (state: RunsFeedState, action: RunsFeedAction): RunsFeedState => {
  switch (action.kind) {
    case 'message': {
      const { message }: { message: ServerMessage } = action;
      switch (message.type) {
        case 'runs.snapshot': {
          const { type: _type, ...body }: Extract<ServerMessage, { type: 'runs.snapshot' }> =
            message;
          return applySnapshot(state, body);
        }
        case 'run.changed':
          return applyRunChanged(state, message);
        case 'pipelines.changed':
          return applyPipelines(state, message.pipelines);
        default:
          return state;
      }
    }
    case 'connection':
      // The data stays on screen either way; a reopen brings a snapshot (`settled` again).
      return action.state === 'open'
        ? state.source === 'live'
          ? state
          : { ...state, settled: false }
        : { ...state, source: 'unreachable', settled: false };
    case 'forget': {
      const data: DashboardData = withoutRun(state.data, action.ref);
      return data === state.data ? state : { ...state, data };
    }
  }
};

/** Whether a `run.changed` frame names a file of this run document (or a file under this folder). */
export const touchesDocument = (change: RunChanged, ref: RunRef, path: string): boolean =>
  change.runId === ref.runId &&
  (change.folder === ref.pipelineId || change.pipelineId === ref.pipelineId) &&
  change.paths.some((p: string): boolean =>
    path.endsWith('/') ? p.startsWith(path) || p === path.slice(0, -1) : p === path,
  );
