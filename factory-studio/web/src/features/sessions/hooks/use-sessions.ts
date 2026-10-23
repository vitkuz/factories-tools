import { useCallback, useEffect, useRef, useState } from 'react';
import { isApiError, toApiError, type ApiError } from '../../../adapters/http/api-error.utils';
import { listSessions, startSession, stopSession } from '../../../adapters/http/studio-api.adapter';
import { usePolling } from '../../../shared/lib/polling';
import type {
  FactorySession,
  SessionList,
  SessionsState,
  StartRequest,
  StartedSession,
} from '../sessions.types';
import {
  describeRefusal,
  describeStarted,
  provisionalSession,
  sortOldestFirst,
} from '../sessions.utils';

/** The list's own refresh: the fallback while the socket is closed, a slow sweep while it is open. */
export const REFRESH_MS = 10_000;
export const REFRESH_LIVE_MS = 60_000;

export interface Sessions {
  state: SessionsState;
  refresh: () => void;
  start: (request: StartRequest) => Promise<void>;
  stop: (session: string) => Promise<void>;
  dismiss: () => void;
}

const asApiError = (error: unknown): ApiError => (isApiError(error) ? error : toApiError(error));

/** The running sessions: listed on mount and every `refreshMs` (10 s by default), started and stopped from here. */
export const useSessions = (refreshMs: number = REFRESH_MS): Sessions => {
  const [state, setState] = useState<SessionsState>({
    sessions: [],
    updatedAt: Date.now(),
    refreshing: false,
    error: null,
    notice: null,
  });
  const inflight = useRef<AbortController | null>(null);

  const refresh = useCallback((): void => {
    inflight.current?.abort();
    const controller: AbortController = new AbortController();
    inflight.current = controller;
    setState((s: SessionsState): SessionsState => ({ ...s, refreshing: true }));
    listSessions(controller.signal)
      .then((list: SessionList): void => {
        if (controller.signal.aborted) return;
        inflight.current = null;
        setState((s: SessionsState): SessionsState => ({
          ...s,
          sessions: sortOldestFirst(list.sessions),
          updatedAt: Date.now(),
          refreshing: false,
          error: null,
        }));
      })
      .catch((error: unknown): void => {
        if (controller.signal.aborted) return;
        inflight.current = null;
        setState((s: SessionsState): SessionsState => ({
          ...s,
          refreshing: false,
          error: asApiError(error).message,
        }));
      });
  }, []);

  useEffect(() => {
    refresh();
    return () => inflight.current?.abort();
  }, [refresh]);

  usePolling(refresh, refreshMs);

  const start = useCallback(async (request: StartRequest): Promise<void> => {
    try {
      const started: StartedSession = await startSession({ ...request, harness: 'claude' });
      const row: FactorySession = provisionalSession(started, Date.now());
      setState((s: SessionsState): SessionsState => ({
        ...s,
        sessions: [
          ...s.sessions.filter((x: FactorySession): boolean => x.session !== row.session),
          row,
        ],
        notice: describeStarted(started),
      }));
    } catch (error: unknown) {
      setState((s: SessionsState): SessionsState => ({
        ...s,
        notice: describeRefusal(asApiError(error)),
      }));
    }
  }, []);

  const stop = useCallback(async (session: string): Promise<void> => {
    try {
      await stopSession({ session });
      setState((s: SessionsState): SessionsState => ({
        ...s,
        sessions: s.sessions.filter((x: FactorySession): boolean => x.session !== session),
        notice: { tone: 'ok', title: `Stopped ${session}`, lines: [] },
      }));
    } catch (error: unknown) {
      setState((s: SessionsState): SessionsState => ({
        ...s,
        notice: describeRefusal(asApiError(error)),
      }));
    }
  }, []);

  const dismiss = useCallback(
    (): void => setState((s: SessionsState): SessionsState => ({ ...s, notice: null })),
    [],
  );

  return { state, refresh, start, stop, dismiss };
};
