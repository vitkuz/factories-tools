import { useEffect, type ReactNode } from 'react';
import type { FactorySession } from '../../sessions/sessions.types';
import { SessionChat } from './SessionChat';

interface ChatDrawerProps {
  sessionId: string;
  session: FactorySession | null;
  onClose: () => void;
}

/**
 * The live chat as a panel over the right side of the screen (all of it on a phone). Escape
 * or the backdrop closes it. Keyed by session, so another session starts a fresh chat.
 */
export const ChatDrawer = ({ sessionId, session, onClose }: ChatDrawerProps): ReactNode => {
  useEffect((): (() => void) => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="chat-layer">
      <div className="chat-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="chat-drawer" role="dialog" aria-modal="true" aria-label="Live session">
        <SessionChat key={sessionId} sessionId={sessionId} session={session} onClose={onClose} />
      </div>
    </div>
  );
};
