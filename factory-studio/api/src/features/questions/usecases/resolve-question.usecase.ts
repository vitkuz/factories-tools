import type { QuestionResolvedPayload, QuestionStore } from '../questions.types.js';

export interface ResolveQuestionSettings {
  store: QuestionStore;
}

/**
 * PostToolUse: Claude got an answer. When the question is still held here, it was answered
 * in the terminal (or by another path): settle it as `terminal`, which clears it from every
 * client and ends the record on disk. Already settled: nothing to do.
 */
export const resolveQuestionFactory =
  ({ store }: ResolveQuestionSettings) =>
  ({ sessionId, toolUseId }: QuestionResolvedPayload): void => {
    store.findByToolUse(sessionId, toolUseId)?.settle({ action: 'dismiss' }, 'terminal');
  };
