import { useCallback, useEffect, useMemo, useState } from 'react';
import { isApiError, toApiError, type ApiError } from '../../../adapters/http/api-error.utils';
import { startSession, stopSession } from '../../../adapters/http/studio-api.adapter';
import type {
  FactorySession,
  SessionNotice,
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
import { useQuestions } from './use-questions';
import type { SessionQuestions } from './use-session-questions';

export interface Sessions {
  state: SessionsState;
  start: (request: StartRequest) => Promise<void>;
  stop: (session: string) => Promise<void>;
  dismiss: () => void;
}

/** What this screen adds to the pushed list: rows it started, rows it stopped, its notice. */
interface Local {
  /** Started here and not yet in the pushed list. */
  provisional: FactorySession[];
  /** Stopped here; hidden until the pushed list no longer has them. */
  stopped: string[];
  notice: SessionNotice | null;
}

const asApiError = (error: unknown): ApiError => (isApiError(error) ? error : toApiError(error));

/** The pushed list with the local rows applied: provisional ones added, stopped ones hidden. Pure. */
export const mergeSessions = (
  live: readonly FactorySession[],
  provisional: readonly FactorySession[],
  stopped: readonly string[],
): FactorySession[] =>
  sortOldestFirst([
    ...live.filter((s: FactorySession): boolean => !stopped.includes(s.session)),
    ...provisional.filter(
      (p: FactorySession): boolean =>
        !live.some((s: FactorySession): boolean => s.session === p.session),
    ),
  ]);

/**
 * The running sessions: the list the server pushes over the socket (`sessions.changed`, on
 * subscribe and on every change), started and stopped from here. No request is made to list.
 */
export const useSessions = (): Sessions => {
  const questions: SessionQuestions = useQuestions();
  const live: FactorySession[] = questions.state.sessions;
  const [local, setLocal] = useState<Local>({
    provisional: [],
    stopped: [],
    notice: null,
  });

  // The pushed list is the truth: a row it carries is no longer provisional, a row it lost is no longer "stopped".
  useEffect((): void => {
    setLocal((l: Local): Local => {
      const provisional: FactorySession[] = l.provisional.filter(
        (p: FactorySession): boolean =>
          !live.some((s: FactorySession): boolean => s.session === p.session),
      );
      const stopped: string[] = l.stopped.filter((name: string): boolean =>
        live.some((s: FactorySession): boolean => s.session === name),
      );
      return provisional.length === l.provisional.length && stopped.length === l.stopped.length
        ? l
        : { ...l, provisional, stopped };
    });
  }, [live]);

  const start = useCallback(async (request: StartRequest): Promise<void> => {
    try {
      const started: StartedSession = await startSession({ ...request, harness: 'claude' });
      const row: FactorySession = provisionalSession(started, Date.now());
      setLocal((l: Local): Local => ({
        ...l,
        provisional: [
          ...l.provisional.filter((x: FactorySession): boolean => x.session !== row.session),
          row,
        ],
        notice: describeStarted(started),
      }));
    } catch (error: unknown) {
      setLocal((l: Local): Local => ({ ...l, notice: describeRefusal(asApiError(error)) }));
    }
  }, []);

  const stop = useCallback(async (session: string): Promise<void> => {
    try {
      await stopSession({ session });
      setLocal((l: Local): Local => ({
        ...l,
        provisional: l.provisional.filter((x: FactorySession): boolean => x.session !== session),
        stopped: [...l.stopped, session],
        notice: { tone: 'ok', title: `Stopped ${session}`, lines: [] },
      }));
    } catch (error: unknown) {
      setLocal((l: Local): Local => ({ ...l, notice: describeRefusal(asApiError(error)) }));
    }
  }, []);

  const dismiss = useCallback(
    (): void => setLocal((l: Local): Local => ({ ...l, notice: null })),
    [],
  );

  const state: SessionsState = useMemo(
    (): SessionsState => ({
      sessions: mergeSessions(live, local.provisional, local.stopped),
      notice: local.notice,
    }),
    [live, local],
  );

  return { state, start, stop, dismiss };
};
