import { useCallback, useEffect, useRef, useState } from 'react';
import { isApiError } from '../../../adapters/http/api-error.utils';
import { listRuns } from '../../../adapters/http/studio-api.adapter';
import {
  dashboardEnvelopeSchema,
  describeIssues,
  runRecordSchema,
  type ParseIssue,
} from '../runs.schema';
import type { DashboardData, Pipeline, RunRecord } from '../runs.types';
import type { DataSource } from '../lib/types';

/**
 * The live run list.
 *
 * Starts empty, fetches `GET /api/v1/runs` on mount, then whenever `refresh` is called
 * (polling lives in `usePolling`, so the screen decides the cadence — fast while a run is
 * active, slow otherwise). Objects that did not change between payloads keep their identity
 * (`mergeStable`), so memoised graphs and node components are rebuilt only for runs that moved.
 */

export interface RunsFeed {
  data: DashboardData;
  source: DataSource;
  /** When the data on screen was produced (the last successful fetch). */
  updatedAt: number;
  /** The first fetch has answered (any outcome): the run list is as complete as it gets for now. */
  settled: boolean;
  refreshing: boolean;
  error: string | null;
  /** The last payload failed validation; the previous data is still on screen. */
  invalid: boolean;
  /** The first issues of the last invalid payload, for the error screen. */
  invalidIssues: ParseIssue[];
  /** Runs (`pipelineId/runId`, or `#index`) in the last good payload whose record was invalid and is hidden. */
  dropped: string[];
  refresh: () => void;
}

export const EMPTY_DATA: DashboardData = {
  generatedAt: new Date(0).toISOString(),
  pipelines: {},
  runs: [],
};

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const runKey = (r: RunRecord): string => `${r.pipelineId}/${r.runId}`;

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

interface FetchOk {
  kind: 'ok';
  data: DashboardData;
  dropped: string[];
}
interface FetchFailed {
  kind: 'failed';
  message: string;
}
interface FetchInvalid {
  kind: 'invalid';
  message: string;
  issues: ParseIssue[];
}
export type FetchOutcome = FetchOk | FetchFailed | FetchInvalid;

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
export const parseLivePayload = (body: unknown): FetchOk | FetchInvalid => {
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

const fetchLive = async (signal: AbortSignal): Promise<FetchOutcome> => {
  try {
    const body: unknown = await listRuns(signal);
    return parseLivePayload(body);
  } catch (error: unknown) {
    if (signal.aborted) return { kind: 'failed', message: 'aborted' };
    if (isApiError(error)) {
      if (error.kind === 'invalid')
        return {
          kind: 'invalid',
          message: error.message,
          issues: error.issues.map((line: string): ParseIssue => ({ path: '', message: line })),
        };
      return { kind: 'failed', message: error.message };
    }
    return { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
};

interface FeedMeta {
  source: DataSource;
  updatedAt: number;
  settled: boolean;
  refreshing: boolean;
  error: string | null;
  invalid: boolean;
  invalidIssues: ParseIssue[];
  dropped: string[];
}

export const useRunsFeed = (): RunsFeed => {
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [meta, setMeta] = useState<FeedMeta>({
    source: 'unreachable',
    updatedAt: Date.now(),
    settled: false,
    refreshing: false,
    error: null,
    invalid: false,
    invalidIssues: [],
    dropped: [],
  });
  const dataRef = useRef<DashboardData>(EMPTY_DATA);
  const inflight = useRef<AbortController | null>(null);

  const refresh = useCallback((): void => {
    inflight.current?.abort();
    const controller: AbortController = new AbortController();
    inflight.current = controller;
    setMeta((m) => ({ ...m, refreshing: true }));

    void fetchLive(controller.signal).then((outcome: FetchOutcome): void => {
      if (controller.signal.aborted) return;
      inflight.current = null;
      if (outcome.kind === 'ok') {
        const merged: DashboardData = mergeStable(dataRef.current, outcome.data);
        dataRef.current = merged;
        setData(merged);
        setMeta({
          source: 'live',
          updatedAt: Date.now(),
          settled: true,
          refreshing: false,
          error: null,
          invalid: false,
          invalidIssues: [],
          dropped: outcome.dropped,
        });
      } else if (outcome.kind === 'invalid') {
        // A half-written state.json or a schema drift: keep what is on screen, say so.
        setMeta((m) => ({
          ...m,
          settled: true,
          refreshing: false,
          invalid: true,
          invalidIssues: outcome.issues,
          error: null,
        }));
      } else if (outcome.message !== 'aborted') {
        setMeta((m) => ({
          ...m,
          source: 'unreachable',
          settled: true,
          refreshing: false,
          error: outcome.message,
        }));
      }
    });
  }, []);

  // First fetch on mount.
  useEffect(() => {
    refresh();
    return () => inflight.current?.abort();
  }, [refresh]);

  return { data, ...meta, refresh };
};

/** Newest run that has state and a known pipeline; else the newest with state; else the first. */
export const pickDefaultRun = (data: DashboardData): RunRecord | undefined => {
  const known = (r: RunRecord): boolean => Boolean(r.pipeline ?? data.pipelines[r.pipelineId]);
  const runs: RunRecord[] = data.runs;
  return runs.find((r) => r.hasState && known(r)) ?? runs.find((r) => r.hasState) ?? runs[0];
};

/** The pipeline a run should be drawn transitions: its own snapshot first, else the definition by id. */
export const resolvePipeline =
  (data: DashboardData) =>
  (run: RunRecord): Pipeline | null =>
    run.pipeline ?? data.pipelines[run.pipelineId] ?? null;
