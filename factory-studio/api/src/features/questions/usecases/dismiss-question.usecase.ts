import type {
  DismissQuestionPayload,
  PendingEntry,
  QuestionActionResult,
  QuestionStore,
} from '../questions.types.js';

export interface DismissQuestionSettings {
  store: QuestionStore;
}

/** "Answer in the terminal": the hook exits silently and Claude opens its own dialog. */
export const dismissQuestionFactory =
  ({ store }: DismissQuestionSettings) =>
  ({ sessionId, promptId }: DismissQuestionPayload): QuestionActionResult => {
    const entry: PendingEntry | undefined = store.get(sessionId, promptId);
    if (!entry) return { ok: false, reason: 'not-found' };
    entry.settle({ action: 'dismiss' });
    return { ok: true };
  };
