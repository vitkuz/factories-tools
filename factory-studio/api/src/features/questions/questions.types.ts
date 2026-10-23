import type { z } from 'zod';
import type { SessionRunLink } from '../runs/runs.types.js';
import type {
  answerQuestionPayloadSchema,
  answerSchema,
  askUserQuestionPayloadSchema,
  clientMessageSchema,
  dismissQuestionPayloadSchema,
  pendingQuestionSchema,
  questionResolvedPayloadSchema,
  questionSchema,
  resolveReasonSchema,
  serverMessageSchema,
} from './questions.schema.js';

export type Question = z.infer<typeof questionSchema>;
export type PendingQuestion = z.infer<typeof pendingQuestionSchema>;
export type Answer = z.infer<typeof answerSchema>;
export type AskUserQuestionPayload = z.infer<typeof askUserQuestionPayloadSchema>;
export type QuestionResolvedPayload = z.infer<typeof questionResolvedPayloadSchema>;
export type AnswerQuestionPayload = z.infer<typeof answerQuestionPayloadSchema>;
export type DismissQuestionPayload = z.infer<typeof dismissQuestionPayloadSchema>;
export type ResolveReason = z.infer<typeof resolveReasonSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;

/** What the blocked hook receives: the answers keyed by question text, or "use the terminal". */
export type HookOutcome =
  { action: 'answer'; answers: Record<string, string> } | { action: 'dismiss' };

/** A question waiting for a person; `settle` releases the hook that is blocked on it. */
export interface PendingEntry {
  question: PendingQuestion;
  settle: (outcome: HookOutcome, reason?: ResolveReason) => void;
}

export interface QuestionStore {
  add: (entry: PendingEntry) => void;
  get: (sessionId: string, promptId: string) => PendingEntry | undefined;
  findByToolUse: (sessionId: string, toolUseId: string) => PendingEntry | undefined;
  remove: (promptId: string) => void;
  list: () => PendingQuestion[];
}

export type Broadcast = (message: ServerMessage) => void;

/** The run a question belongs to, or `null` when it cannot be told (see `findSessionRun`). */
export type LocateQuestionRun = (payload: AskUserQuestionPayload) => Promise<SessionRunLink | null>;

export type QuestionActionResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'invalid'; message: string };

export interface QuestionUsecases {
  /** Blocks until answered, dismissed, timed out, or `signal` aborts (the hook went away). */
  registerQuestion: (payload: AskUserQuestionPayload, signal?: AbortSignal) => Promise<HookOutcome>;
  answerQuestion: (payload: AnswerQuestionPayload) => QuestionActionResult;
  dismissQuestion: (payload: DismissQuestionPayload) => QuestionActionResult;
  resolveQuestion: (payload: QuestionResolvedPayload) => void;
  listPending: () => PendingQuestion[];
}
