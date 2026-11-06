import type { AppLogger } from '../../../shared/types.js';
import type { QuestionLifecycle } from '../services/question-lifecycle.service.js';
import type { HookOutcome, QuestionJournal, QuestionRecord } from '../questions.types.js';
import { fromQuestionRecord, isUnfinished } from '../questions.utils.js';

export interface RestoreQuestionsSettings {
  journal: QuestionJournal;
  lifecycle: QuestionLifecycle;
  logger?: AppLogger;
}

/** The outcome a record says was taken while the hook was away, to hand over on its next request. */
const queuedOf = (record: QuestionRecord): HookOutcome | undefined => {
  if (record.status === 'answered' && record.answers !== undefined && record.delivered === false)
    return { action: 'answer', answers: record.answers };
  if (record.status === 'dismissed' && record.delivered === false) return { action: 'dismiss' };
  return undefined;
};

/**
 * At startup: every question the journal says is still open comes back into the store, so
 * the first `hello` lists it in full and the hook, which keeps asking, finds it under its
 * old promptId. Returns how many were taken up.
 */
export const restoreQuestionsFactory =
  ({ journal, lifecycle, logger }: RestoreQuestionsSettings) =>
  async (): Promise<number> => {
    const records: QuestionRecord[] = (await journal.list()).filter(isUnfinished);
    for (const record of records) {
      const { question, source } = fromQuestionRecord(record);
      lifecycle.adopt(question, source, queuedOf(record));
      logger?.info('question restored from disk', {
        sessionId: question.sessionId,
        promptId: question.promptId,
        channel: question.channel,
        queued: record.status !== 'pending',
      });
    }
    return records.length;
  };
