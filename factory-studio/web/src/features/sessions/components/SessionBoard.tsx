import { useState, type ReactNode } from 'react';
import type { SocketState } from '../../../shared/lib/use-websocket';
import { Notice } from '../../../shared/components/Notice';
import type {
  Answer,
  FactorySession,
  PendingQuestion,
  QuestionsState,
  SessionBoard as Board,
} from '../sessions.types';
import {
  effectiveStatus,
  groupSessions,
  idleSend,
  needsYouCount,
  openPromptId,
  waitedFor,
} from '../sessions.utils';
import { QuestionCard } from './QuestionCard';
import { TerminalWaitCard } from './TerminalWaitCard';
import { IdleCard, WorkingCard } from './SessionCard';

interface SessionBoardProps {
  sessions: FactorySession[];
  state: QuestionsState;
  connection: SocketState;
  /** The session whose Stop is in flight. */
  stopping: string | null;
  now: number;
  onAnswer: (question: PendingQuestion, answers: Answer[]) => void;
  onClearError: () => void;
  onStop: (session: string) => void;
  onOpenChat: (session: string) => void;
}

interface ColumnProps {
  label: string;
  tone: 'needs-you' | 'working' | 'idle';
  count: number;
  empty: string;
  /** Notices drawn above the cards. */
  lead?: ReactNode;
  children: ReactNode[];
}

/** One board column: an uppercase name and a count over its cards, or a line when it has none. */
const Column = ({ label, tone, count, empty, lead, children }: ColumnProps): ReactNode => (
  <section className={`board-column is-${tone}`} aria-label={label}>
    <header className="board-column-head">
      <h2 className="board-column-title">{label}</h2>
      <span
        className={tone === 'needs-you' ? 'board-column-badge' : 'board-column-count'}
        aria-label={`${count} ${label.toLowerCase()}`}
      >
        {count}
      </span>
    </header>
    <div className="board-column-body">
      {lead}
      {children.length > 0 ? children : <p className="board-column-empty">{empty}</p>}
    </div>
  </section>
);

/** Every running session in three columns: what waits for a person, what works, what sits idle. */
export const SessionBoard = ({
  sessions,
  state,
  connection,
  stopping,
  now,
  onAnswer,
  onClearError,
  onStop,
  onOpenChat,
}: SessionBoardProps): ReactNode => {
  // undefined: nothing picked yet (the oldest is open); null: "Later" closed them all.
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const board: Board = groupSessions(sessions, state);
  const open: string | null = openPromptId(board.questions, chosen);
  const connected: boolean = connection === 'open';
  const factoryOf = (session: string): string | null =>
    sessions.find((s: FactorySession): boolean => s.session === session)?.factoryId ?? null;

  return (
    <div className="board">
      <Column
        label="Needs you"
        tone="needs-you"
        count={needsYouCount(board)}
        empty="Nothing needs you right now."
        lead={
          <>
            {!connected ? (
              <Notice tone="plain">
                Live connection is down. Reconnecting; you cannot answer meanwhile.
              </Notice>
            ) : null}
            {state.lastError !== null ? (
              <div className="ask-error">
                <Notice tone="refusal">{state.lastError}</Notice>
                <button type="button" className="ghost-button" onClick={onClearError}>
                  Dismiss
                </button>
              </div>
            ) : null}
          </>
        }
      >
        {[
          ...board.questions.map((question: PendingQuestion) => (
            <QuestionCard
              key={question.promptId}
              question={question}
              send={state.prompts[question.promptId] ?? idleSend}
              factoryId={factoryOf(question.sessionId)}
              wait={waitedFor(question.askedAt, now)}
              connected={connected}
              open={open === question.promptId}
              stopping={stopping === question.sessionId}
              onOpen={(): void => setChosen(question.promptId)}
              onLater={(): void => setChosen(null)}
              onAnswer={onAnswer}
              onStop={(): void => onStop(question.sessionId)}
              onOpenChat={(): void => onOpenChat(question.sessionId)}
            />
          )),
          ...board.terminal.map((session: FactorySession) => (
            <TerminalWaitCard
              key={session.session}
              sessionId={session.session}
              factoryId={session.factoryId}
              stopping={stopping === session.session}
              onStop={(): void => onStop(session.session)}
              onOpenChat={(): void => onOpenChat(session.session)}
            />
          )),
        ]}
      </Column>
      <Column
        label="Working"
        tone="working"
        count={board.working.length}
        empty="Answer a question and the session moves here."
      >
        {board.working.map((session: FactorySession) => (
          <WorkingCard
            key={session.session}
            session={session}
            status="working"
            stopping={stopping === session.session}
            onStop={(): void => onStop(session.session)}
            onOpenChat={(): void => onOpenChat(session.session)}
          />
        ))}
      </Column>
      <Column label="Idle" tone="idle" count={board.idle.length} empty="No idle sessions.">
        {board.idle.map((session: FactorySession) => (
          <IdleCard
            key={session.session}
            session={session}
            status={effectiveStatus(session, state.statuses)}
            stopping={stopping === session.session}
            onStop={(): void => onStop(session.session)}
            onOpenChat={(): void => onOpenChat(session.session)}
          />
        ))}
      </Column>
    </div>
  );
};
