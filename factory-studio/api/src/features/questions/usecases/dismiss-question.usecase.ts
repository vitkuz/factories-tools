import type {
  DismissQuestionPayload,
  PendingEntry,
  QuestionActionResult,
  QuestionStore,
} from '../questions.types.js';
import { TERMINAL_ONLY } from './answer-question.usecase.js';

export interface DismissQuestionSettings {
  store: QuestionStore;
}

/** "Answer in the terminal": the hook exits silently and Claude opens its own dialog. */
export const dismissQuestionFactory =
  ({ store }: DismissQuestionSettings) =>
  ({ sessionId, promptId }: DismissQuestionPayload): QuestionActionResult => {
    const entry: PendingEntry | undefined = store.get(sessionId, promptId);
    if (!entry || entry.queued !== null) return { ok: false, reason: 'not-found' };
    if (entry.question.channel === 'terminal')
      return { ok: false, reason: 'invalid', message: TERMINAL_ONLY };
    entry.settle({ action: 'dismiss' });
    return { ok: true };
  };
