import type { z } from 'zod';
import type { SessionRunLink } from '../runs/runs.types.js';
import type {
  answerQuestionPayloadSchema,
  answerSchema,
  askUserQuestionPayloadSchema,
  clientMessageSchema,
  dismissQuestionPayloadSchema,
  pendingQuestionSchema,
  questionChannelSchema,
  questionRecordSchema,
  questionResolvedPayloadSchema,
  questionSchema,
  questionStatusSchema,
  resolveReasonSchema,
  serverMessageSchema,
} from './questions.schema.js';

export type Question = z.infer<typeof questionSchema>;
export type PendingQuestion = z.infer<typeof pendingQuestionSchema>;
export type QuestionChannel = z.infer<typeof questionChannelSchema>;
export type QuestionRecord = z.infer<typeof questionRecordSchema>;
export type QuestionStatus = z.infer<typeof questionStatusSchema>;
export type Answer = z.infer<typeof answerSchema>;
export type AskUserQuestionPayload = z.infer<typeof askUserQuestionPayloadSchema>;
export type QuestionResolvedPayload = z.infer<typeof questionResolvedPayloadSchema>;
export type AnswerQuestionPayload = z.infer<typeof answerQuestionPayloadSchema>;
export type DismissQuestionPayload = z.infer<typeof dismissQuestionPayloadSchema>;
export type ResolveReason = z.infer<typeof resolveReasonSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;

/**
 * What the blocked hook receives: the answers keyed by question text, "use the terminal", or
 * "ask again" (`wait`: the long poll was cut on purpose; the hook posts the same question
 * again at once and gets the same pending entry back).
 */
export type HookOutcome =
  | { action: 'answer'; answers: Record<string, string> }
  | { action: 'dismiss' }
  | { action: 'wait' };

/** Where a question came from, kept with it so the record on disk says so after a restart. */
export interface QuestionSource {
  claudeSessionId?: string;
  transcriptPath?: string;
}

/**
 * A question waiting for a person. `settle` ends it whatever the hook is doing: an attached
 * hook gets the outcome at once; a hook that is away (the API restarted, its poll was cut)
 * finds the outcome queued on its next request. The rest is the entry's live state.
 */
export interface PendingEntry {
  question: PendingQuestion;
  source: QuestionSource;
  settle: (outcome: HookOutcome, reason?: ResolveReason) => void;
  /** The hook request waiting for the outcome; `null` while no request holds the question. */
  waiter: ((outcome: HookOutcome) => void) | null;
  /** When the last hook request went away, ms since the epoch; `null` while one is attached. */
  detachedAt: number | null;
  /** An outcome taken while no hook was attached, handed over on the hook's next request. */
  queued: HookOutcome | null;
  /** When the session was first missing from the herdr list, ms; `null` while it is listed. */
  missingSince: number | null;
}

export interface QuestionStore {
  add: (entry: PendingEntry) => void;
  /** Replaces the entry with the same promptId; a no-op for one that is not there. */
  set: (entry: PendingEntry) => void;
  get: (sessionId: string, promptId: string) => PendingEntry | undefined;
  findByToolUse: (sessionId: string, toolUseId: string) => PendingEntry | undefined;
  remove: (promptId: string) => void;
  list: () => PendingQuestion[];
  entries: () => PendingEntry[];
}

/** The questions on disk: one file per question, rewritten on every change. */
export interface QuestionJournal {
  write: (record: QuestionRecord) => Promise<void>;
  /** Every readable record; a file that does not parse is skipped and logged. */
  list: () => Promise<QuestionRecord[]>;
}

export type Broadcast = (message: ServerMessage) => void;

/** The run a question belongs to, or `null` when it cannot be told (see `findSessionRun`). */
export type LocateQuestionRun = (payload: AskUserQuestionPayload) => Promise<SessionRunLink | null>;

export type QuestionActionResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'invalid'; message: string };

export interface QuestionUsecases {
  /**
   * Blocks until answered, dismissed, or the long poll is cut (`wait`); `signal` aborting (the
   * hook request went away) detaches the hook but keeps the question.
   */
  registerQuestion: (payload: AskUserQuestionPayload, signal?: AbortSignal) => Promise<HookOutcome>;
  answerQuestion: (payload: AnswerQuestionPayload) => QuestionActionResult;
  dismissQuestion: (payload: DismissQuestionPayload) => QuestionActionResult;
  resolveQuestion: (payload: QuestionResolvedPayload) => void;
  listPending: () => PendingQuestion[];
}
