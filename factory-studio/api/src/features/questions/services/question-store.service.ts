import type { PendingEntry, PendingQuestion, QuestionStore } from '../questions.types.js';

/**
 * The questions waiting for a person, in memory: a pending question is a blocked hook process,
 * and both go away with the API. A closure over one Map; nothing else holds it.
 */
export const createQuestionStore = (): QuestionStore => {
  const entries: Map<string, PendingEntry> = new Map();
  return {
    add: (entry: PendingEntry): void => {
      entries.set(entry.question.promptId, entry);
    },
    get: (sessionId: string, promptId: string): PendingEntry | undefined => {
      const entry: PendingEntry | undefined = entries.get(promptId);
      return entry?.question.sessionId === sessionId ? entry : undefined;
    },
    findByToolUse: (sessionId: string, toolUseId: string): PendingEntry | undefined =>
      [...entries.values()].find(
        (entry: PendingEntry): boolean =>
          entry.question.sessionId === sessionId &&
          toolUseId !== '' &&
          entry.question.toolUseId === toolUseId,
      ),
    remove: (promptId: string): void => {
      entries.delete(promptId);
    },
    list: (): PendingQuestion[] =>
      [...entries.values()].map((entry: PendingEntry): PendingQuestion => entry.question),
  };
};
