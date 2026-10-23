import type { z } from 'zod';
import type { WsClient } from '../../shared/ws/ws.types.js';
import type {
  chatClientMessageSchema,
  chatItemKindSchema,
  chatItemSchema,
  chatServerMessageSchema,
  chatUnavailableReasonSchema,
  contentBlockSchema,
  sessionStartPayloadSchema,
  subagentMetaSchema,
  transcriptLinkSchema,
  transcriptRecordSchema,
} from './chat.schema.js';

export type ContentBlock = z.infer<typeof contentBlockSchema>;
export type TranscriptRecord = z.infer<typeof transcriptRecordSchema>;
export type SubagentMeta = z.infer<typeof subagentMetaSchema>;
export type ChatItemKind = z.infer<typeof chatItemKindSchema>;
export type ChatItem = z.infer<typeof chatItemSchema>;
export type SessionStartPayload = z.infer<typeof sessionStartPayloadSchema>;
export type TranscriptLink = z.infer<typeof transcriptLinkSchema>;
export type ChatClientMessage = z.infer<typeof chatClientMessageSchema>;
export type ChatServerMessage = z.infer<typeof chatServerMessageSchema>;
export type ChatUnavailableReason = z.infer<typeof chatUnavailableReasonSchema>;

/** How much of a long value an item carries; the rest is a `ref` away. */
export interface ChatLimits {
  text: number;
  input: number;
  output: number;
}

/** Where a transcript line came from, so the whole item can be read again later. */
export interface LineSource {
  /** `main`, or the subagent's id. */
  source: string;
  start: number;
  end: number;
}

/** What turning one record into items needs to know besides the record. */
export interface MapContext {
  /** Tool names by tool_use id, so a result can say which tool it answers. */
  toolNames: ReadonlyMap<string, string>;
  limits: ChatLimits;
  /** Set when the record comes from a subagent's transcript. */
  agent?: { agentId: string; parentToolUseId?: string };
  line: LineSource;
}

/** One complete line of a file and where it sits, in bytes. */
export interface TranscriptLine {
  text: string;
  start: number;
  end: number;
}

/** The lines a chunk completed, and the unfinished tail that waits for the next chunk. */
export interface SplitLines {
  lines: TranscriptLine[];
  /** Bytes of the last, unterminated line. */
  rest: Buffer;
  /** Where `rest` starts in the file. */
  restStart: number;
}

/** The files of one session's transcript on disk. */
export interface TranscriptFiles {
  main: string;
  /** `<session-id>/subagents`, beside the main file. */
  subagentsDir: string;
}

/** Where a studio session's transcript is, and whose it is. */
export interface ResolvedTranscript {
  claudeSessionId: string;
  path: string;
}

/** A live tail of one transcript, main file and subagent files. */
export interface TranscriptTailer {
  /** Reads everything already in the files. Resolves once the backlog is in memory. */
  start: () => Promise<void>;
  stop: () => void;
  /** One read of whatever was appended, awaited. */
  poll: () => Promise<void>;
  /** The newest items held, at most `limit`, and how many older ones are not in the answer. */
  snapshot: (limit: number) => { items: ChatItem[]; dropped: number };
  path: string;
}

export type CreateTailer = (
  transcript: ResolvedTranscript,
  onItems: (items: ChatItem[]) => void,
) => TranscriptTailer;

export interface ChatHistory {
  sessionId: string;
  claudeSessionId: string;
  items: ChatItem[];
  dropped: number;
}

export type ChatHistoryResult =
  { ok: true; history: ChatHistory } | { ok: false; reason: ChatUnavailableReason };

export type ChatItemResult =
  { ok: true; item: ChatItem } | { ok: false; reason: ChatUnavailableReason | 'not-found' };

/** The live chats: who watches which session, and the tailers that feed them. */
export interface ChatHub {
  subscribe: (sessionId: string, client: WsClient) => Promise<void>;
  unsubscribe: (sessionId: string, clientId: string) => void;
  /** A socket closed: every subscription it had is over. */
  dropClient: (clientId: string) => void;
  /** The live session names, every status poll: ends chats of gone sessions, retries waiting ones. */
  reconcile: (liveSessions: readonly string[]) => Promise<void>;
  /** The SessionStart hook reported a (new) transcript: a running tail moves to it. */
  relink: (sessionId: string) => Promise<void>;
  history: (sessionId: string, limit: number) => Promise<ChatHistoryResult>;
  readItem: (sessionId: string, itemId: string, ref: string) => Promise<ChatItemResult>;
  /** Stops every tailer. */
  close: () => void;
}

/** What `server.ts` hands the routes. */
export interface ChatUsecases {
  recordSessionStart: (payload: SessionStartPayload) => Promise<boolean>;
  history: ChatHub['history'];
  readItem: ChatHub['readItem'];
}
