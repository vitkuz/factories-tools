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

export const TERMINAL_ONLY = 'this question is in the terminal now; answer it there';

/**
 * Validates against the questions that were asked, then settles the question: a waiting hook
 * gets the answers at once, a hook that is away gets them on its next request. A question
 * that fell to Claude's own dialog cannot be answered from here.
 */
export const answerQuestionFactory =
  ({ store }: AnswerQuestionSettings) =>
  ({ sessionId, promptId, answers }: AnswerQuestionPayload): QuestionActionResult => {
    const entry: PendingEntry | undefined = store.get(sessionId, promptId);
    if (!entry || entry.queued !== null) return { ok: false, reason: 'not-found' };
    if (entry.question.channel === 'terminal')
      return { ok: false, reason: 'invalid', message: TERMINAL_ONLY };
    const problem: string | null = validateAnswers(entry.question.questions, answers);
    if (problem !== null) return { ok: false, reason: 'invalid', message: problem };
    entry.settle({ action: 'answer', answers: buildAnswersMap(answers) });
    return { ok: true };
  };
