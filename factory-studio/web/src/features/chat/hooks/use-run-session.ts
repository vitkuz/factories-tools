import { useCallback, useEffect, useState } from 'react';
import { listSessions } from '../../../adapters/http/studio-api.adapter';
import { usePolling } from '../../../shared/lib/polling';
import { useQuestions } from '../../sessions/hooks/use-questions';
import type { SessionQuestions } from '../../sessions/hooks/use-session-questions';
import type { FactorySession, SessionList, SessionRunLink } from '../../sessions/sessions.types';
import { findRunSession } from '../chat.utils';

/** How often the run page looks for the run's session: a session's list entry changes slowly. */
const REFRESH_MS = 15_000;

/**
 * The studio session a run is live in, or `null`: the session list, polled while the run page
 * is open, matched by the Claude session id the run carries or by a question tied to the run.
 */
export const useRunSession = (
  run: Pick<SessionRunLink, 'pipelineId' | 'runId'>,
  claudeSessionId: string,
): FactorySession | null => {
  const questions: SessionQuestions = useQuestions();
  const [sessions, setSessions] = useState<FactorySession[]>([]);

  const refresh = useCallback((): (() => void) => {
    const controller: AbortController = new AbortController();
    listSessions(controller.signal)
      .then((list: SessionList): void => {
        if (!controller.signal.aborted) setSessions(list.sessions);
      })
      .catch((): void => {
        // No list, no panel: the run page does without.
      });
    return (): void => controller.abort();
  }, []);

  useEffect((): (() => void) => refresh(), [refresh]);
  usePolling(refresh, REFRESH_MS);

  return findRunSession(sessions, claudeSessionId, questions.state.pending, run);
};
