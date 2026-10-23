import type { z } from 'zod';
import type {
  answerSchema,
  clientMessageSchema,
  factoryParamSchema,
  factorySessionSchema,
  harnessSchema,
  paramValueSchema,
  pipelineListEntrySchema,
  pipelineListSchema,
  pendingQuestionSchema,
  questionOptionSchema,
  questionSchema,
  resolveReasonSchema,
  serverMessageSchema,
  sessionListSchema,
  sessionRunLinkSchema,
  sessionStatusSchema,
  startSessionPayloadSchema,
  startedSessionSchema,
  stopSessionPayloadSchema,
  stoppedSchema,
} from './sessions.schema';

export type PipelineListEntry = z.infer<typeof pipelineListEntrySchema>;
export type PipelineList = z.infer<typeof pipelineListSchema>;
export type FactoryParam = z.infer<typeof factoryParamSchema>;
export type ParamValue = z.infer<typeof paramValueSchema>;

/** How the start form shows one param. */
export type ParamWidget = 'text' | 'textarea' | 'number' | 'checkbox';

/** What a person has typed for one factory's params: numbers stay text until they are sent. */
export type ParamDraft = Record<string, string | boolean>;

/** What the start form hands up: the factory, its params, and the free text. */
export interface StartRequest {
  id: string;
  params: Record<string, ParamValue>;
  /** Extra instructions when the factory has params, the whole prompt when it has none. */
  prompt: string;
}

/** The load of the pipeline list the start form picks from. */
export type ListState = 'loading' | 'ready' | 'failed';

export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type QuestionOption = z.infer<typeof questionOptionSchema>;
export type Question = z.infer<typeof questionSchema>;
export type PendingQuestion = z.infer<typeof pendingQuestionSchema>;
export type SessionRunLink = z.infer<typeof sessionRunLinkSchema>;
export type Answer = z.infer<typeof answerSchema>;
export type ResolveReason = z.infer<typeof resolveReasonSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;

/** What a person has picked and typed for one question so far (not yet sent). */
export interface Draft {
  selected: string[];
  text: string;
}

/** Where one answer is: nothing sent, in flight, accepted by the socket, or failed. */
export interface SendState {
  phase: 'idle' | 'sending' | 'sent' | 'error';
  error: string | null;
}

export interface QuestionsState {
  pending: PendingQuestion[];
  /** The latest status per session name, from the socket. */
  statuses: Record<string, SessionStatus>;
  /** Per promptId. */
  prompts: Record<string, SendState>;
  /** A socket `error` that names no prompt. */
  lastError: string | null;
}

export type QuestionsAction =
  | { kind: 'message'; message: ServerMessage }
  | { kind: 'sending'; promptId: string }
  | { kind: 'failed'; promptId: string; message: string }
  | { kind: 'disconnected' }
  | { kind: 'clear-error' };

export type Harness = z.infer<typeof harnessSchema>;
export type FactorySession = z.infer<typeof factorySessionSchema>;
export type SessionList = z.infer<typeof sessionListSchema>;
export type StartedSession = z.infer<typeof startedSessionSchema>;
export type Stopped = z.infer<typeof stoppedSchema>;
export type StartSessionPayload = z.infer<typeof startSessionPayloadSchema>;
export type StopSessionPayload = z.infer<typeof stopSessionPayloadSchema>;

/** A message on the Sessions screen: what a start did, or why the API refused. */
export interface SessionNotice {
  tone: 'ok' | 'refusal';
  title: string;
  lines: string[];
}

export interface SessionsState {
  sessions: FactorySession[];
  /** When the list was last fetched successfully. */
  updatedAt: number;
  refreshing: boolean;
  /** The list could not be fetched; the last list stays on screen. */
  error: string | null;
  notice: SessionNotice | null;
}

/** The board's columns, left to right. */
export type BoardColumn = 'needs-you' | 'working' | 'idle';

/** What each board column shows. */
export interface SessionBoard {
  /** Claude's questions the studio can answer, oldest first. */
  questions: PendingQuestion[];
  /** Blocked sessions with no such question: their dialog is open in the terminal. */
  terminal: FactorySession[];
  working: FactorySession[];
  idle: FactorySession[];
}
