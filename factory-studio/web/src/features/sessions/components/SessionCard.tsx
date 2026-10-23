import type { ReactNode } from 'react';
import type { FactorySession, SessionStatus } from '../sessions.types';
import { STATUS_META } from '../sessions.utils';
import { formatTime } from '../../runs/lib/format';
import { CardHead } from './CardHead';
import { StopButton } from './StopButton';
import { ChatButton } from './ChatButton';

interface SessionCardProps {
  session: FactorySession;
  /** The status the card names: `working`, or what put it among the idle ones. */
  status: SessionStatus | null;
  stopping: boolean;
  onStop: () => void;
  onOpenChat: () => void;
}

/** When it started and how long it has run — all the list knows; herdr gives no "since" for a status. */
const startedLine = (session: FactorySession, prefix: string = ''): ReactNode => (
  <span className="board-card-meta">
    {prefix}started{' '}
    <time dateTime={session.startedAt} title={session.startedAt}>
      {formatTime(session.startedAt)}
    </time>{' '}
    · {session.age}
  </span>
);

/** A working session: name, a live status dot, its factory, when it started, Chat and Stop. */
export const WorkingCard = ({
  session,
  stopping,
  onStop,
  onOpenChat,
}: SessionCardProps): ReactNode => (
  <article className="board-card" aria-label={`${session.session}, working`}>
    <CardHead session={session.session} factoryId={session.factoryId}>
      <span className="board-card-status is-working">
        <span className="board-card-dot" aria-hidden="true" />
        working
      </span>
    </CardHead>
    <div className="board-card-row">
      {startedLine(session)}
      <span className="board-card-actions">
        <ChatButton session={session.session} onOpen={onOpenChat} />
        <StopButton stopping={stopping} onStop={onStop} />
      </span>
    </div>
  </article>
);

/** An idle (or done, or not yet known) session: name and status on the left, Chat and Stop on the right. */
export const IdleCard = ({
  session,
  status,
  stopping,
  onStop,
  onOpenChat,
}: SessionCardProps): ReactNode => (
  <article
    className="board-card is-row"
    aria-label={`${session.session}, ${status ? STATUS_META[status].label : 'no status yet'}`}
  >
    <div className="board-card-text">
      <CardHead session={session.session} />
      {startedLine(session, status ? `${STATUS_META[status].label} · ` : '')}
    </div>
    <span className="board-card-actions">
      <ChatButton session={session.session} onOpen={onOpenChat} />
      <StopButton stopping={stopping} onStop={onStop} />
    </span>
  </article>
);
