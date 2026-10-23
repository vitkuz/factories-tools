import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react';
import { Notice } from '../../../shared/components/Notice';
import { useNow } from '../../../shared/lib/polling';
import { QuestionCard } from '../../sessions/components/QuestionCard';
import { useQuestions } from '../../sessions/hooks/use-questions';
import type { SessionQuestions } from '../../sessions/hooks/use-session-questions';
import type { FactorySession, PendingQuestion, SessionStatus } from '../../sessions/sessions.types';
import {
  STATUS_META,
  idleSend,
  openPromptId,
  shortSessionName,
  waitedFor,
} from '../../sessions/sessions.utils';
import type { ChatRow, ChatState } from '../chat.types';
import { PAGE_ROWS, buildRows, isNearBottom } from '../chat.utils';
import { useSessionChat, type SessionChat as Chat } from '../hooks/use-session-chat';
import { Rows } from './ChatRows';

interface SessionChatProps {
  sessionId: string;
  /** The session as the list knows it; `null` before the list has it. */
  session: FactorySession | null;
  onClose: () => void;
}

const UNAVAILABLE: Record<NonNullable<ChatState['reason']>, string> = {
  'no-transcript':
    'Claude has not written a transcript for this session yet. The chat starts as soon as it does.',
  'unknown-session': 'There is no running session by this name.',
};

/** A line under the rows: why there are none, or that the session is over. */
const phaseNotice = (state: ChatState): ReactNode => {
  if (state.phase === 'ended') return <Notice tone="plain">The session has ended.</Notice>;
  if (state.phase === 'unavailable' && state.reason) {
    return <Notice tone="plain">{UNAVAILABLE[state.reason]}</Notice>;
  }
  if (state.phase === 'connecting' && state.items.length === 0) {
    return <p className="chat-empty">Loading the conversation…</p>;
  }
  if (state.phase === 'live' && state.items.length === 0) {
    return <p className="chat-empty">Nothing said yet.</p>;
  }
  return null;
};

/**
 * One session's conversation, live: Claude's and the person's messages as bubbles, tool calls
 * as rows that open to their input and output, a subagent's work folded under the call that
 * started it, and the question Claude waits on (if any) at the bottom, answerable in place.
 * Follows new rows while the reader is at the bottom; scrolling up stops that until
 * "Jump to latest".
 */
export const SessionChat = ({ sessionId, session, onClose }: SessionChatProps): ReactNode => {
  const questions: SessionQuestions = useQuestions();
  const chat: Chat = useSessionChat(sessionId);
  const { state } = chat;
  const rows: ChatRow[] = useMemo((): ChatRow[] => buildRows(state.items), [state.items]);
  const [shown, setShown] = useState<number>(PAGE_ROWS);
  const [follow, setFollow] = useState<boolean>(true);
  const scroller = useRef<HTMLDivElement | null>(null);
  // undefined: nothing picked yet (the oldest is open); null: "Later" closed them all.
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);

  const asked: PendingQuestion[] = questions.state.pending.filter(
    (question: PendingQuestion): boolean => question.sessionId === sessionId,
  );
  const now: number = useNow(asked.length > 0 ? 1000 : null);
  const open: string | null = openPromptId(asked, chosen);
  const connected: boolean = questions.connection === 'open';
  const status: SessionStatus | null =
    questions.state.statuses[sessionId] ?? session?.status ?? null;
  const visible: ChatRow[] = rows.slice(Math.max(0, rows.length - shown));
  const hidden: number = rows.length - visible.length;

  // New rows (or a new question) keep the view at the bottom while the reader follows.
  useLayoutEffect((): void => {
    const box: HTMLDivElement | null = scroller.current;
    if (box && follow) box.scrollTop = box.scrollHeight;
  }, [rows, asked.length, follow]);

  const onScroll = (event: UIEvent<HTMLDivElement>): void => {
    const near: boolean = isNearBottom(event.currentTarget);
    if (near !== follow) setFollow(near);
  };

  const jump = (): void => {
    setFollow(true);
    const box: HTMLDivElement | null = scroller.current;
    if (box) box.scrollTop = box.scrollHeight;
  };

  return (
    <section className="chat" aria-label={`Live chat of ${sessionId}`}>
      <header className="chat-head">
        <div className="chat-head-text">
          <span className="mono chat-head-name" title={sessionId}>
            {shortSessionName(sessionId)}
          </span>
          {session ? <span className="mono chat-head-factory">{session.factoryId}</span> : null}
        </div>
        <span
          className="chat-status"
          style={{ ['--tone' as string]: `var(${STATUS_META[status ?? 'unknown'].token})` }}
          role="status"
        >
          <span className={`chat-status-dot${status === 'working' ? ' is-pulsing' : ''}`} />
          {state.phase === 'ended' ? 'ended' : STATUS_META[status ?? 'unknown'].label}
        </span>
        <button type="button" className="ghost-button chat-close" onClick={onClose}>
          Close
        </button>
      </header>
      {!connected ? <Notice tone="plain">Live connection is down. Reconnecting…</Notice> : null}
      <div className="chat-scroll" ref={scroller} onScroll={onScroll}>
        {state.dropped > 0 || hidden > 0 ? (
          <div className="chat-earlier">
            {hidden > 0 ? (
              <button
                type="button"
                className="ghost-button"
                onClick={(): void => setShown((n: number): number => n + PAGE_ROWS)}
              >
                Show earlier ({hidden})
              </button>
            ) : null}
            {state.dropped > 0 ? (
              <span className="chat-dropped">
                {state.dropped.toLocaleString('en-US')} older items are not loaded
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="chat-rows">
          <Rows rows={visible} onExpand={chat.expand} />
        </div>
        {phaseNotice(state)}
        {asked.map((question: PendingQuestion) => (
          <div className="chat-ask" key={question.promptId}>
            <QuestionCard
              question={question}
              send={questions.state.prompts[question.promptId] ?? idleSend}
              factoryId={session?.factoryId ?? null}
              wait={waitedFor(question.askedAt, now)}
              connected={connected}
              open={open === question.promptId}
              onOpen={(): void => setChosen(question.promptId)}
              onLater={(): void => setChosen(null)}
              onAnswer={questions.answer}
            />
          </div>
        ))}
      </div>
      {!follow ? (
        <button type="button" className="chat-jump" onClick={jump}>
          Jump to latest ↓
        </button>
      ) : null}
    </section>
  );
};
