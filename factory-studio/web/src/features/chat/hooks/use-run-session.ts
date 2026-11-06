import { useQuestions } from '../../sessions/hooks/use-questions';
import type { SessionQuestions } from '../../sessions/hooks/use-session-questions';
import type { FactorySession, SessionRunLink } from '../../sessions/sessions.types';
import { findRunSession } from '../chat.utils';

/**
 * The studio session a run is live in, or `null`: the session list the socket pushes, matched
 * by the Claude session id the run carries or by a question tied to the run. Nothing is fetched.
 */
export const useRunSession = (
  run: Pick<SessionRunLink, 'pipelineId' | 'runId'>,
  claudeSessionId: string,
): FactorySession | null => {
  const { state }: SessionQuestions = useQuestions();
  return findRunSession(state.sessions, claudeSessionId, state.pending, run);
};
