import type { AppLogger } from '../../../shared/types.js';
import type {
  Broadcast,
  HookOutcome,
  PendingEntry,
  PendingQuestion,
  QuestionJournal,
  QuestionRecord,
  QuestionSource,
  QuestionStatus,
  QuestionStore,
  ResolveReason,
} from '../questions.types.js';
import { toQuestionRecord } from '../questions.utils.js';

export interface QuestionLifecycleSettings {
  store: QuestionStore;
  broadcast: Broadcast;
  /** Absent in tests that only look at the store; the real thing always has one. */
  journal?: QuestionJournal;
  /** How long one hook request is held before it is told to ask again (`wait`). */
  longPollMs?: number;
  logger?: AppLogger;
  now?: () => Date;
}

export interface QuestionLifecycle {
  /** A new question: in the store, on disk as pending, shown to every client. */
  open: (question: PendingQuestion, source: QuestionSource) => PendingEntry;
  /** A question read back from disk: in the store, detached as of `now`, no broadcast. */
  adopt: (question: PendingQuestion, source: QuestionSource, queued?: HookOutcome) => PendingEntry;
  /**
   * The hook's request takes the question: a queued outcome is handed over at once; otherwise
   * the request waits for `settle`, for the long poll to end (`wait`), or for `signal` (the
   * request went away: the question stays, detached).
   */
  attach: (entry: PendingEntry, signal?: AbortSignal) => Promise<HookOutcome>;
  /** The hook is not coming back: the question is now in Claude's dialog in the pane. */
  markTerminal: (promptId: string) => void;
}

export const DEFAULT_LONG_POLL_MS = 600_000;

const reasonOf = (outcome: HookOutcome): ResolveReason =>
  outcome.action === 'answer' ? 'answered' : 'dismissed';

/**
 * What happens to a question over its life, in one place, so the register, answer, restore and
 * reconcile usecases agree on it: every change lands in the store, on disk and on the socket.
 */
export const createQuestionLifecycle = ({
  store,
  broadcast,
  journal,
  longPollMs = DEFAULT_LONG_POLL_MS,
  logger,
  now = (): Date => new Date(),
}: QuestionLifecycleSettings): QuestionLifecycle => {
  const persist = (
    entry: Pick<PendingEntry, 'question' | 'source'>,
    status: QuestionStatus,
    extra: Pick<QuestionRecord, 'answers' | 'resolvedAt' | 'delivered'> = {},
  ): void => {
    journal?.write(toQuestionRecord(entry, status, extra)).catch((error: unknown): void => {
      logger?.error('could not write the question record', {
        promptId: entry.question.promptId,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  };

  const current = (promptId: string): PendingEntry | undefined =>
    store.entries().find((entry: PendingEntry): boolean => entry.question.promptId === promptId);

  /**
   * Ends the question. With a hook attached the outcome goes to it and the entry goes away.
   * Without one, an answer or a dismissal is queued for the hook's next request (the entry
   * stays, so the request finds it by toolUseId); any other reason ends the entry outright.
   */
  const settle = (promptId: string, outcome: HookOutcome, reason: ResolveReason): void => {
    const entry: PendingEntry | undefined = current(promptId);
    if (!entry) return;
    const { sessionId }: PendingQuestion = entry.question;
    const answers: Record<string, string> | undefined =
      outcome.action === 'answer' ? outcome.answers : undefined;
    const resolvedAt: string = now().toISOString();
    if (entry.waiter) {
      entry.waiter(outcome);
      store.remove(promptId);
      persist(entry, reason, { answers, resolvedAt, delivered: true });
    } else if (reason === 'answered' || reason === 'dismissed') {
      store.set({ ...entry, queued: outcome });
      persist(entry, reason, { answers, resolvedAt, delivered: false });
    } else {
      store.remove(promptId);
      persist(entry, reason, { resolvedAt });
    }
    broadcast({ type: 'session.question.resolved', sessionId, promptId, reason });
    logger?.info('question settled', {
      sessionId,
      promptId,
      reason,
      attached: entry.waiter !== null,
    });
  };

  const makeEntry = (
    question: PendingQuestion,
    source: QuestionSource,
    detachedAt: number | null,
    queued: HookOutcome | null,
  ): PendingEntry => ({
    question,
    source,
    settle: (outcome: HookOutcome, reason?: ResolveReason): void =>
      settle(question.promptId, outcome, reason ?? reasonOf(outcome)),
    waiter: null,
    detachedAt,
    queued,
    missingSince: null,
  });

  const open = (question: PendingQuestion, source: QuestionSource): PendingEntry => {
    const entry: PendingEntry = makeEntry(question, source, now().getTime(), null);
    store.add(entry);
    persist(entry, 'pending');
    broadcast({ type: 'session.question', question });
    return entry;
  };

  const adopt = (
    question: PendingQuestion,
    source: QuestionSource,
    queued?: HookOutcome,
  ): PendingEntry => {
    const entry: PendingEntry = makeEntry(question, source, now().getTime(), queued ?? null);
    store.add(entry);
    return entry;
  };

  const detach = (promptId: string, waiter: (outcome: HookOutcome) => void): void => {
    const entry: PendingEntry | undefined = current(promptId);
    if (entry && entry.waiter === waiter) {
      store.set({ ...entry, waiter: null, detachedAt: now().getTime() });
    }
  };

  const attach = (entry: PendingEntry, signal?: AbortSignal): Promise<HookOutcome> => {
    const { promptId, sessionId }: PendingQuestion = entry.question;
    const live: PendingEntry | undefined = current(promptId);
    if (!live) return Promise.resolve({ action: 'dismiss' });
    if (live.queued) {
      const reason: ResolveReason = reasonOf(live.queued);
      store.remove(promptId);
      persist(live, reason, {
        answers: live.queued.action === 'answer' ? live.queued.answers : undefined,
        resolvedAt: now().toISOString(),
        delivered: true,
      });
      logger?.info('queued outcome handed to the hook', { sessionId, promptId, reason });
      return Promise.resolve(live.queued);
    }
    if (signal?.aborted) return Promise.resolve({ action: 'wait' });
    return new Promise<HookOutcome>((resolve): void => {
      const timer: NodeJS.Timeout = setTimeout((): void => {
        detach(promptId, waiter);
        resolve({ action: 'wait' });
      }, longPollMs);
      const waiter = (outcome: HookOutcome): void => {
        clearTimeout(timer);
        resolve(outcome);
      };
      signal?.addEventListener(
        'abort',
        (): void => {
          clearTimeout(timer);
          detach(promptId, waiter);
          resolve({ action: 'wait' });
        },
        { once: true },
      );
      // A question that had fallen to the terminal is the hook's again: say so to the clients.
      const question: PendingQuestion = { ...live.question, channel: 'hook' };
      store.set({ ...live, question, waiter, detachedAt: null });
      if (live.question.channel !== 'hook') {
        persist({ question, source: live.source }, 'pending');
        broadcast({ type: 'session.question', question });
      }
    });
  };

  const markTerminal = (promptId: string): void => {
    const entry: PendingEntry | undefined = current(promptId);
    if (!entry || entry.question.channel === 'terminal') return;
    const question: PendingQuestion = { ...entry.question, channel: 'terminal' };
    store.set({ ...entry, question });
    persist({ question, source: entry.source }, 'pending');
    broadcast({ type: 'session.question', question });
    logger?.info('question fell to the terminal', { sessionId: question.sessionId, promptId });
  };

  return { open, adopt, attach, markTerminal };
};
