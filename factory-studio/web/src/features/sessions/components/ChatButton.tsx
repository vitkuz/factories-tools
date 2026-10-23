import type { ReactNode } from 'react';

interface ChatButtonProps {
  session: string;
  onOpen: () => void;
}

/** Opens the session's live chat: what Claude is doing, as a conversation. */
export const ChatButton = ({ session, onOpen }: ChatButtonProps): ReactNode => (
  <button
    type="button"
    className="ghost-button chat-open-button"
    aria-label={`Open the live chat of ${session}`}
    onClick={onOpen}
  >
    Chat
  </button>
);
