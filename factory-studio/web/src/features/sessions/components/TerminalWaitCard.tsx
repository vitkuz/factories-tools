import type { ReactNode } from 'react';
import { CardHead } from './CardHead';
import { StopButton } from './StopButton';

interface TerminalWaitCardProps {
  sessionId: string;
  factoryId: string;
  stopping: boolean;
  onStop: () => void;
}

/**
 * A blocked session with no question the studio can answer: Claude's own dialog is open in the
 * terminal (the studio's box was not used, or timed out). Typed text would only pick the
 * highlighted option there, so the card says where to answer instead of offering a reply field.
 */
export const TerminalWaitCard = ({
  sessionId,
  factoryId,
  stopping,
  onStop,
}: TerminalWaitCardProps): ReactNode => (
  <article className="board-card ask-card" aria-label={`${sessionId} is waiting in the terminal`}>
    <CardHead session={sessionId} factoryId={factoryId} />
    <span className="ask-title">Waiting in the terminal</span>
    <p className="ask-terminal-text">
      Claude&rsquo;s own question dialog is open in this session&rsquo;s terminal and can only be
      answered there. Attach to the session, pick workspace {sessionId}, and answer with the arrow
      keys and Enter. Or stop the session.
    </p>
    <pre className="mono ask-terminal-command">herdr session attach factory-studio</pre>
    <div className="board-card-row is-end">
      <StopButton stopping={stopping} onStop={onStop} />
    </div>
  </article>
);
