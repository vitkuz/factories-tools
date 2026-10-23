import { formatIssues, type ApiError } from '../../adapters/http/api-error.utils';
import type {
  Answer,
  BoardColumn,
  Draft,
  FactoryParam,
  FactorySession,
  ParamDraft,
  ParamValue,
  ParamWidget,
  PendingQuestion,
  PipelineListEntry,
  Question,
  QuestionsAction,
  QuestionsState,
  SendState,
  ServerMessage,
  SessionBoard,
  SessionNotice,
  SessionRunLink,
  SessionStatus,
  StartRequest,
  StartedSession,
} from './sessions.types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/** `details.sessions[].session` of a 409, or `details.running[].session` of a 404. */
const sessionNames = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap((v: unknown): string[] =>
        isRecord(v) && typeof v.session === 'string' ? [v.session] : [],
      )
    : [];

/** An API refusal on the Sessions screen, as a readable notice — never only in the console. */
export const describeRefusal = (error: ApiError): SessionNotice => {
  if (error.kind === 'network')
    return { tone: 'refusal', title: 'The API is not answering', lines: [error.message] };
  if (error.kind === 'invalid')
    return { tone: 'refusal', title: error.message, lines: error.issues };
  const details: Record<string, unknown> = isRecord(error.details) ? error.details : {};
  switch (error.status) {
    case 400:
      return {
        tone: 'refusal',
        title: `Refused: ${error.message}`,
        lines: formatIssues(error.details),
      };
    case 404: {
      const available: string[] = stringList(details.available);
      const running: string[] = sessionNames(details.running);
      return {
        tone: 'refusal',
        title: `Refused: ${error.message}`,
        lines: [
          ...(available.length > 0 ? [`Available: ${available.join(', ')}`] : []),
          ...(running.length > 0 ? [`Running: ${running.join(', ')}`] : []),
        ],
      };
    }
    case 409:
      return {
        tone: 'refusal',
        title: `Refused: ${error.message}`,
        lines: sessionNames(details.sessions).map((s: string): string => `Session: ${s}`),
      };
    case 502:
      return {
        tone: 'refusal',
        title: error.message,
        lines: [
          typeof details.session === 'string' ? `Session: ${details.session}` : '',
          typeof details.harness === 'string' ? `Harness: ${details.harness}` : '',
          'Start the API from a shell whose PATH holds the harness binary.',
        ].filter(Boolean),
      };
    default:
      return { tone: 'refusal', title: `HTTP ${error.status}: ${error.message}`, lines: [] };
  }
};

export const describeStarted = (started: StartedSession): SessionNotice => ({
  tone: 'ok',
  title: `Started ${started.session}`,
  lines: [
    `Factory: ${started.factoryId} · harness: ${started.harness}`,
    `Prompt file: ${started.promptFile}`,
    `Attach with: herdr session attach factory-studio (workspace ${started.session})`,
  ],
});

/** The API sorts oldest first; kept here so the list never depends on it. */
export const sortOldestFirst = (sessions: FactorySession[]): FactorySession[] =>
  [...sessions].sort((a: FactorySession, b: FactorySession): number => b.ageSeconds - a.ageSeconds);

/** What the list shows for a session just started from this screen, until the next refresh replaces it. */
export const provisionalSession = (started: StartedSession, now: number): FactorySession => ({
  session: started.session,
  factoryId: started.factoryId,
  harness: started.harness,
  startedAt: new Date(now).toISOString(),
  ageSeconds: 0,
  age: '0s',
});

/* ---------------------------------------------------------------- start form */

/** A default longer than this would not fit a one-line input. */
const LONG_DEFAULT = 40;

/**
 * How a param is shown, from its default alone — never from its name or its factory: a
 * checkbox for a boolean, a number input for a number, a growing textarea for text whose
 * default is long or has a newline, a one-line input for any other text.
 */
export const paramWidget = (param: FactoryParam): ParamWidget => {
  if (param.type === 'boolean') return 'checkbox';
  if (param.type === 'number') return 'number';
  const text: string = String(param.default);
  return text.length > LONG_DEFAULT || text.includes('\n') ? 'textarea' : 'text';
};

/** Every param at its default; a number as the text its input shows. */
export const initialParamDraft = (params: readonly FactoryParam[]): ParamDraft =>
  Object.fromEntries(
    params.map((param: FactoryParam): [string, string | boolean] => [
      param.name,
      typeof param.default === 'boolean' ? param.default : String(param.default),
    ]),
  );

const draftText = (draft: ParamDraft, param: FactoryParam): string => {
  const value: string | boolean | undefined = draft[param.name];
  return value === undefined ? String(param.default) : String(value);
};

/** The required params still blank, in declaration order. */
export const missingParams = (params: readonly FactoryParam[], draft: ParamDraft): string[] =>
  params
    .filter(
      (param: FactoryParam): boolean =>
        param.required && param.type === 'string' && draftText(draft, param).trim() === '',
    )
    .map((param: FactoryParam): string => param.name);

/** The number params whose text is not a number the runner would take (whole for a whole default). */
export const invalidParams = (params: readonly FactoryParam[], draft: ParamDraft): string[] =>
  params
    .filter((param: FactoryParam): boolean => {
      if (param.type !== 'number') return false;
      const text: string = draftText(draft, param).trim();
      const parsed: number = Number(text);
      return (
        text === '' ||
        !Number.isFinite(parsed) ||
        (Number.isInteger(param.default) && !Number.isInteger(parsed))
      );
    })
    .map((param: FactoryParam): string => param.name);

/** The draft as the API takes it: every param, numbers as numbers, text as typed. */
export const serializeParams = (
  params: readonly FactoryParam[],
  draft: ParamDraft,
): Record<string, ParamValue> =>
  Object.fromEntries(
    params.map((param: FactoryParam): [string, ParamValue] => {
      const value: string | boolean | undefined = draft[param.name];
      if (param.type === 'boolean')
        return [param.name, typeof value === 'boolean' ? value : param.default];
      const text: string = draftText(draft, param);
      return [param.name, param.type === 'number' ? Number(text.trim()) : text];
    }),
  );

/** Why Start is not available yet, or `null` when it is. */
export const startBlocker = (
  entry: PipelineListEntry | undefined,
  draft: ParamDraft,
  prompt: string,
): string | null => {
  if (entry === undefined) return 'Pick a factory';
  if (entry.params.length === 0)
    return prompt.trim() === '' ? 'Write what the factory should do' : null;
  const missing: string[] = missingParams(entry.params, draft);
  if (missing.length > 0) return `Fill in ${missing.join(', ')}`;
  const invalid: string[] = invalidParams(entry.params, draft);
  if (invalid.length > 0) return `${invalid.join(', ')}: not a valid number`;
  return null;
};

/** What a start sends: the params when the factory has any, the free text either way. */
export const buildStartRequest = (
  entry: PipelineListEntry,
  draft: ParamDraft,
  prompt: string,
): StartRequest => ({
  id: entry.id,
  params: entry.params.length > 0 ? serializeParams(entry.params, draft) : {},
  prompt: prompt.trim(),
});

/* ---------------------------------------------------------------- answering a question */

export const emptyDraft: Draft = { selected: [], text: '' };

export const draftsFor = (questions: Question[]): Draft[] => questions.map((): Draft => emptyDraft);

/** A question counts as answered once a label is picked or some text is typed. */
export const isAnswered = (draft: Draft): boolean =>
  draft.selected.length > 0 || draft.text.trim() !== '';

export const answeredCount = (drafts: Draft[]): number => drafts.filter(isAnswered).length;

/** Every question has a draft and every draft is answered. */
export const isComplete = (questions: Question[], drafts: Draft[]): boolean =>
  questions.length > 0 &&
  questions.every((_: Question, index: number): boolean => {
    const draft: Draft | undefined = drafts[index];
    return draft !== undefined && isAnswered(draft);
  });

/**
 * Picking a label: a single-select question holds one label and drops the typed text (the text
 * is the "other" choice); a multi-select one toggles the label and keeps the text.
 */
export const toggleOption = (question: Question, draft: Draft, label: string): Draft => {
  if (!question.multiSelect) return { selected: [label], text: '' };
  return draft.selected.includes(label)
    ? { ...draft, selected: draft.selected.filter((l: string): boolean => l !== label) }
    : { ...draft, selected: [...draft.selected, label] };
};

/** Typing: on a single-select question it replaces the picked label. */
export const setDraftText = (question: Question, draft: Draft, text: string): Draft =>
  question.multiSelect || text.trim() === '' ? { ...draft, text } : { selected: [], text };

export const replaceDraft = (drafts: Draft[], index: number, draft: Draft): Draft[] =>
  drafts.map((d: Draft, i: number): Draft => (i === index ? draft : d));

/** The `session.answer` payload: one entry per question, in order; labels in the order of the options. */
export const buildAnswers = (questions: Question[], drafts: Draft[]): Answer[] =>
  questions.map((question: Question, index: number): Answer => {
    const draft: Draft = drafts[index] ?? emptyDraft;
    const text: string = draft.text.trim();
    return {
      question: question.question,
      selected: question.options
        .map((option: { label: string }): string => option.label)
        .filter((label: string): boolean => draft.selected.includes(label)),
      ...(text !== '' ? { text } : {}),
    };
  });

/* ---------------------------------------------------------------- status */

export const STATUS_META: Record<SessionStatus, { label: string; token: string }> = {
  idle: { label: 'idle', token: '--st-pending' },
  working: { label: 'working', token: '--st-running' },
  blocked: { label: 'waiting for you', token: '--st-waiting' },
  done: { label: 'done', token: '--st-completed' },
  unknown: { label: 'unknown', token: '--st-none' },
};

/** The socket's latest word on a session wins; the list's own status is the fallback. */
export const effectiveStatus = (
  session: FactorySession,
  statuses: Record<string, SessionStatus>,
): SessionStatus | null => statuses[session.session] ?? session.status ?? null;

/** Blocked sessions with no pending question: Claude's own dialog is open in the terminal. */
export const sessionsNeedingReply = (
  sessions: FactorySession[],
  state: QuestionsState,
): FactorySession[] =>
  sessions.filter(
    (session: FactorySession): boolean =>
      effectiveStatus(session, state.statuses) === 'blocked' &&
      !state.pending.some((p: PendingQuestion): boolean => p.sessionId === session.session),
  );

/* ---------------------------------------------------------------- board */

/**
 * Which board column a session sits in. A pending question wins over the herdr status: while
 * the studio holds Claude's question the pane still reports `working`. `done`, `unknown` and
 * no status yet all count as idle.
 */
export const boardColumnOf = (session: FactorySession, state: QuestionsState): BoardColumn => {
  if (state.pending.some((p: PendingQuestion): boolean => p.sessionId === session.session))
    return 'needs-you';
  const status: SessionStatus | null = effectiveStatus(session, state.statuses);
  if (status === 'blocked') return 'needs-you';
  if (status === 'working') return 'working';
  return 'idle';
};

/**
 * The sessions split into the board's three columns. "Needs you" holds every pending question
 * (also one whose session the list has not caught up with yet) and the blocked sessions whose
 * question can only be answered in the terminal.
 */
export const groupSessions = (sessions: FactorySession[], state: QuestionsState): SessionBoard => ({
  questions: state.pending,
  terminal: sessionsNeedingReply(sessions, state),
  working: sessions.filter(
    (session: FactorySession): boolean => boardColumnOf(session, state) === 'working',
  ),
  idle: sessions.filter(
    (session: FactorySession): boolean => boardColumnOf(session, state) === 'idle',
  ),
});

export const needsYouCount = (board: SessionBoard): number =>
  board.questions.length + board.terminal.length;

/** Every session is `factory-*`; the board drops the prefix and keeps the full name in `title`. */
export const shortSessionName = (session: string): string => session.replace(/^factory-/, '');

/** "just now", "45s", "20m", "2h 5m" — the same short form the API gives a session's age. */
export const compactAge = (seconds: number): string => {
  const s: number = Math.max(0, Math.floor(seconds));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s`;
  const m: number = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h: number = Math.floor(m / 60);
  return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`;
};

/** How long a question has waited, from its `askedAt`; empty when the time is not readable. */
export const waitedFor = (askedAt: string, now: number): string => {
  const asked: number = new Date(askedAt).getTime();
  return Number.isNaN(asked) ? '' : compactAge((now - asked) / 1000);
};

/** The collapsed card's line: the one question itself, or how many there are and how far along. */
export const questionPreview = (questions: Question[], drafts: Draft[]): string => {
  if (questions.length === 1) return questions[0]?.question ?? '';
  const answered: number = answeredCount(drafts);
  return `${questions.length} questions${answered > 0 ? ` · ${answered} answered` : ''}`;
};

/**
 * The one question card that is open: the person's pick while it still waits, none after
 * "Later" (`null`), otherwise the oldest — so answering one opens the next.
 */
export const openPromptId = (
  pending: PendingQuestion[],
  chosen: string | null | undefined,
): string | null => {
  if (chosen === null) return null;
  if (pending.some((p: PendingQuestion): boolean => p.promptId === chosen)) return chosen ?? null;
  return pending[0]?.promptId ?? null;
};

/** The questions asked by the session that runs this run, oldest first. */
export const questionsForRun = (
  pending: readonly PendingQuestion[],
  ref: Pick<SessionRunLink, 'pipelineId' | 'runId'>,
): PendingQuestion[] =>
  pending.filter(
    (p: PendingQuestion): boolean =>
      p.run !== undefined && p.run.pipelineId === ref.pipelineId && p.run.runId === ref.runId,
  );

/** The tab title: how many prompts wait for a person. */
export const titleWithCount = (title: string, count: number): string =>
  count > 0 ? `(${count}) ${title}` : title;

/* ---------------------------------------------------------------- socket state */

export const idleSend: SendState = { phase: 'idle', error: null };

export const initialQuestionsState: QuestionsState = {
  pending: [],
  statuses: {},
  prompts: {},
  lastError: null,
};

const withPrompt = (state: QuestionsState, promptId: string, send: SendState): QuestionsState => ({
  ...state,
  prompts: { ...state.prompts, [promptId]: send },
});

const withoutKey = <T>(record: Record<string, T>, key: string): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([k]: [string, T]): boolean => k !== key));

const upsertQuestion = (pending: PendingQuestion[], next: PendingQuestion): PendingQuestion[] =>
  pending.some((p: PendingQuestion): boolean => p.promptId === next.promptId)
    ? pending.map((p: PendingQuestion): PendingQuestion =>
        p.promptId === next.promptId ? next : p,
      )
    : [...pending, next];

const applyMessage = (state: QuestionsState, message: ServerMessage): QuestionsState => {
  switch (message.type) {
    case 'hello': {
      const ids: string[] = message.pending.map((p: PendingQuestion): string => p.promptId);
      return {
        ...state,
        pending: message.pending,
        prompts: Object.fromEntries(
          Object.entries(state.prompts).filter(([id]: [string, SendState]): boolean =>
            ids.includes(id),
          ),
        ),
        lastError: null,
      };
    }
    case 'session.question':
      return { ...state, pending: upsertQuestion(state.pending, message.question) };
    case 'session.question.resolved':
      return {
        ...state,
        pending: state.pending.filter(
          (p: PendingQuestion): boolean => p.promptId !== message.promptId,
        ),
        prompts: withoutKey(state.prompts, message.promptId),
      };
    case 'session.status':
      return {
        ...state,
        statuses: { ...state.statuses, [message.sessionId]: message.status },
      };
    // The live chat's frames: `useSessionChat` reads them, the question state has no part in them.
    case 'session.chat.backlog':
    case 'session.chat.items':
    case 'session.chat.unavailable':
    case 'session.chat.ended':
      return state;
    case 'error': {
      const ref: string | undefined = message.ref;
      if (ref !== undefined && state.prompts[ref] !== undefined)
        return withPrompt(state, ref, { phase: 'error', error: message.message });
      return { ...state, lastError: message.message };
    }
  }
};

/** Pure reducer of everything the socket tells the screen and everything the person sent. */
export const reduceQuestions = (state: QuestionsState, action: QuestionsAction): QuestionsState => {
  switch (action.kind) {
    case 'message':
      return applyMessage(state, action.message);
    case 'sending':
      return withPrompt(state, action.promptId, { phase: 'sending', error: null });
    case 'failed':
      return withPrompt(state, action.promptId, { phase: 'error', error: action.message });
    case 'disconnected':
      return {
        ...state,
        // An answer in flight may or may not have landed; the next hello settles it.
        prompts: Object.fromEntries(
          Object.entries(state.prompts).map(
            ([id, send]: [string, SendState]): [string, SendState] => [
              id,
              send.phase === 'sending'
                ? {
                    phase: 'error',
                    error: 'The connection dropped before the answer was confirmed.',
                  }
                : send,
            ],
          ),
        ),
      };
    case 'clear-error':
      return { ...state, lastError: null };
  }
};

/** Roving tabindex for a tablist: the tab a key moves to, or `null` when the key is not a tab key. */
export const nextTabIndex = (key: string, current: number, count: number): number | null => {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
};
