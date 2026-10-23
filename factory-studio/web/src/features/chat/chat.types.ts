import type { z } from 'zod';
import type { chatItemSchema, chatUnavailableReasonSchema } from './chat.schema';

export type ChatItem = z.infer<typeof chatItemSchema>;
export type ChatUnavailableReason = z.infer<typeof chatUnavailableReasonSchema>;

/** Where the chat is: waiting for its backlog, following, with nothing to show, or over. */
export type ChatPhase = 'connecting' | 'live' | 'unavailable' | 'ended';

export interface ChatState {
  items: ChatItem[];
  /** Older items that are not held (the API's cut plus the app's own cap). */
  dropped: number;
  phase: ChatPhase;
  reason: ChatUnavailableReason | null;
}

export type ChatAction =
  | { kind: 'backlog'; items: ChatItem[]; dropped: number }
  | { kind: 'items'; items: ChatItem[] }
  | { kind: 'unavailable'; reason: ChatUnavailableReason }
  | { kind: 'ended' }
  | { kind: 'reconnecting' }
  /** "Show more" brought the whole of one item. */
  | { kind: 'expanded'; item: ChatItem };

/** What the chat draws: a message line, or a tool call with its result and what its subagent did. */
export type ChatRow =
  | { kind: 'message'; key: string; item: ChatItem }
  | {
      kind: 'tool';
      key: string;
      /** `null` when the call fell off the front and only its result is held. */
      call: ChatItem | null;
      result: ChatItem | null;
      /** A subagent the call started: its opening row and its own rows. */
      subagent: ChatItem | null;
      children: ChatRow[];
    }
  /** A subagent whose starting call is not known (no meta, or the call fell off). */
  | { kind: 'agent'; key: string; subagent: ChatItem | null; children: ChatRow[] };
