import type { QuestionLifecycle } from '../services/question-lifecycle.service.js';
import type { PendingEntry, QuestionStore } from '../questions.types.js';

export interface ReconcileQuestionsSettings {
  store: QuestionStore;
  lifecycle: QuestionLifecycle;
  /**
   * How long a question may sit without a hook request before it counts as fallen to the
   * terminal. The hook asks again within seconds of a `wait`, a dropped connection or an API
   * restart; a hook Claude cancelled or timed out never does.
   */
  detachGraceMs?: number;
  /** How long a session may be missing from the herdr list before its questions count as gone. */
  goneGraceMs?: number;
  now?: () => Date;
}

export const DEFAULT_DETACH_GRACE_MS = 30_000;
export const DEFAULT_GONE_GRACE_MS = 15_000;

/**
 * Every status poll, with the live session names: a question whose session has been gone for
 * a while is closed (`gone`); one whose hook has been away for a while is marked as being in
 * the terminal, so the app shows it with its text but points to the pane. Both graces guard
 * against one empty or late poll.
 */
export const reconcileQuestionsFactory =
  ({
    store,
    lifecycle,
    detachGraceMs = DEFAULT_DETACH_GRACE_MS,
    goneGraceMs = DEFAULT_GONE_GRACE_MS,
    now = (): Date => new Date(),
  }: ReconcileQuestionsSettings) =>
  (liveSessions: readonly string[]): void => {
    const at: number = now().getTime();
    for (const entry of store.entries()) {
      const listed: boolean = liveSessions.includes(entry.question.sessionId);
      if (!listed) {
        const since: number = entry.missingSince ?? at;
        if (at - since >= goneGraceMs) {
          entry.settle({ action: 'dismiss' }, 'gone');
          continue;
        }
        if (entry.missingSince === null) store.set({ ...entry, missingSince: since });
      } else if (entry.missingSince !== null) {
        store.set({ ...entry, missingSince: null });
      }
      const fresh: PendingEntry | undefined = store
        .entries()
        .find((e: PendingEntry): boolean => e.question.promptId === entry.question.promptId);
      if (
        fresh &&
        fresh.waiter === null &&
        fresh.queued === null &&
        fresh.detachedAt !== null &&
        fresh.question.channel === 'hook' &&
        at - fresh.detachedAt >= detachGraceMs
      ) {
        lifecycle.markTerminal(fresh.question.promptId);
      }
    }
  };
