import { useCallback, useEffect, useMemo, useReducer } from 'react';
import type { SocketState } from '../../../shared/lib/use-websocket';
import type { RunRef } from '../../../shared/lib/route';
import { useLiveTopics } from '../../sessions/hooks/use-live-topics';
import { useQuestions } from '../../sessions/hooks/use-questions';
import type { SessionQuestions } from '../../sessions/hooks/use-session-questions';
import type { ServerMessage } from '../../sessions/sessions.types';
import {
  initialRunsFeedState,
  reduceRunsFeed,
  type RunsFeedAction,
  type RunsFeedState,
} from '../runs-feed.utils';
import type { DashboardData, Pipeline, RunRecord } from '../runs.types';

export {
  EMPTY_DATA,
  mergeStable,
  parseLivePayload,
  sortRuns,
  withoutRun,
  type SnapshotOutcome,
} from '../runs-feed.utils';

/**
 * The live run list.
 *
 * Subscribes to the `runs` topic of the app's socket: the server answers with a snapshot (the
 * body of `GET /api/v1/runs`) and then pushes every run whose folder changed on disk, so nothing
 * here runs on a timer. Objects that did not change keep their identity (`mergeStable`), so
 * memoised graphs and node components are rebuilt only for runs that moved.
 */
export interface RunsFeed extends RunsFeedState {
  /** The socket: `open` while frames can arrive, `closed` while it reconnects. */
  connection: SocketState;
  /** Ask the server for the snapshot again (after an invalid one); no timer, no HTTP. */
  resync: () => void;
  /** Drop one run from the data on screen now (it was removed); the server's frame confirms it. */
  forget: (ref: RunRef) => void;
}

const LIVE_FRAMES: ReadonlySet<ServerMessage['type']> = new Set<ServerMessage['type']>([
  'runs.snapshot',
  'run.changed',
  'pipelines.changed',
]);

export const useRunsFeed = (): RunsFeed => {
  const { channel, connection }: SessionQuestions = useQuestions();
  const [state, dispatch] = useReducer<RunsFeedState, [RunsFeedAction]>(
    reduceRunsFeed,
    initialRunsFeedState,
  );
  const resync: () => void = useLiveTopics(['runs']);

  useEffect(
    (): (() => void) =>
      channel.listen((message: ServerMessage): void => {
        if (LIVE_FRAMES.has(message.type)) dispatch({ kind: 'message', message });
      }),
    [channel],
  );

  useEffect((): void => {
    dispatch({ kind: 'connection', state: connection });
  }, [connection]);

  const forget = useCallback((ref: RunRef): void => dispatch({ kind: 'forget', ref }), []);

  return useMemo(
    (): RunsFeed => ({ ...state, connection, resync, forget }),
    [state, connection, resync, forget],
  );
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
