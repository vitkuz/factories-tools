import type {
  AnswerQuestionPayload,
  PendingEntry,
  QuestionActionResult,
  QuestionStore,
} from '../questions.types.js';
import { buildAnswersMap, validateAnswers } from '../questions.utils.js';

export interface AnswerQuestionSettings {
  store: QuestionStore;
}

/** Validates against the questions that were asked, then releases the blocked hook. */
export const answerQuestionFactory =
  ({ store }: AnswerQuestionSettings) =>
  ({ sessionId, promptId, answers }: AnswerQuestionPayload): QuestionActionResult => {
    const entry: PendingEntry | undefined = store.get(sessionId, promptId);
    if (!entry) return { ok: false, reason: 'not-found' };
    const problem: string | null = validateAnswers(entry.question.questions, answers);
    if (problem !== null) return { ok: false, reason: 'invalid', message: problem };
    entry.settle({ action: 'answer', answers: buildAnswersMap(answers) });
    return { ok: true };
  };
