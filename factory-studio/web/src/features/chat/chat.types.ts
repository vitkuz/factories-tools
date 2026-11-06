import type { z } from 'zod';
import type { SessionStatus } from '../sessions/sessions.types';
import type { chatItemSchema, chatUnavailableReasonSchema, sentMessageSchema } from './chat.schema';

export type ChatItem = z.infer<typeof chatItemSchema>;
export type ChatUnavailableReason = z.infer<typeof chatUnavailableReasonSchema>;
export type SentMessage = z.infer<typeof sentMessageSchema>;

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
  | { kind: 'expanded'; item: ChatItem }
  /** A message the person just sent, shown at once; the transcript's own copy replaces it. */
  | { kind: 'pending'; item: ChatItem }
  /** The API refused the message: its bubble goes away (the text stays in the box). */
  | { kind: 'unsent'; id: string };

/** Can the message box take a message now, and if not, why not (one short line). */
export interface ComposerGate {
  enabled: boolean;
  reason: string | null;
}

/** What the gate reads. */
export interface ComposerInput {
  status: SessionStatus | null;
  phase: ChatPhase;
  /** Claude asked a question the studio holds for this session. */
  asked: boolean;
  connected: boolean;
  sending: boolean;
}

/** Where the last send is: nothing in flight, on its way, or refused with a line to show. */
export interface SendState {
  sending: boolean;
  error: string | null;
  /** The last message went in but Claude was not seen starting: a soft warning. */
  notice: string | null;
}

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
