import { useCallback, useState, type ReactNode } from 'react';
import { useQuestions } from '../../sessions/hooks/use-questions';
import type { SessionQuestions } from '../../sessions/hooks/use-session-questions';
import type { FactorySession, SessionRunLink, SessionStatus } from '../../sessions/sessions.types';
import { STATUS_META, shortSessionName } from '../../sessions/sessions.utils';
import { runClaudeSessionId } from '../chat.utils';
import { useRunSession } from '../hooks/use-run-session';
import { ChatDrawer } from './ChatDrawer';

interface LiveSessionPanelProps {
  run: Pick<SessionRunLink, 'pipelineId' | 'runId'> & {
    state?: Parameters<typeof runClaudeSessionId>[0];
  };
}

/**
 * On the run page, when the run is live in a studio session: the session, its status, and the
 * way into its live chat. Nothing at all when no running session can be tied to the run.
 */
export const LiveSessionPanel = ({ run }: LiveSessionPanelProps): ReactNode => {
  const questions: SessionQuestions = useQuestions();
  const session: FactorySession | null = useRunSession(
    { pipelineId: run.pipelineId, runId: run.runId },
    runClaudeSessionId(run.state),
  );
  const [open, setOpen] = useState<boolean>(false);
  const close = useCallback((): void => setOpen(false), []);
  if (session === null) return null;
  const status: SessionStatus =
    questions.state.statuses[session.session] ?? session.status ?? 'unknown';

  return (
    <section className="pane live-session" aria-label="Live session">
      <h3 className="live-session-title">Live session</h3>
      <div className="live-session-row">
        <span
          className="chat-status"
          style={{ ['--tone' as string]: `var(${STATUS_META[status].token})` }}
        >
          <span className={`chat-status-dot${status === 'working' ? ' is-pulsing' : ''}`} />
          {STATUS_META[status].label}
        </span>
        <span className="mono live-session-name" title={session.session}>
          {shortSessionName(session.session)}
        </span>
        <button type="button" className="answer-button" onClick={(): void => setOpen(true)}>
          Open chat
        </button>
      </div>
      {open ? <ChatDrawer sessionId={session.session} session={session} onClose={close} /> : null}
    </section>
  );
};
