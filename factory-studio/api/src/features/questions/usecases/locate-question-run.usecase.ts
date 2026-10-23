import { isSafeSegment } from '../../documents/documents.utils.js';
import type { RunRecord, SessionRunLink } from '../../runs/runs.types.js';
import { findSessionRun } from '../../runs/runs.utils.js';
import type { SessionMeta } from '../../sessions/sessions.types.js';
import type { AskUserQuestionPayload, LocateQuestionRun } from '../questions.types.js';

export interface LocateQuestionRunSettings {
  /** Every run on disk, read fresh. */
  collectRunRecords: () => Promise<RunRecord[]>;
  /** The studio's meta of a session it started; `null` for any other. */
  readSessionMeta: (session: string) => Promise<SessionMeta | null>;
}

/**
 * Which run the asking session is in: the run its Claude session opened (the recorder stamps
 * it), else the first unfinished run of its factory since the studio started it.
 */
export const locateQuestionRunFactory =
  ({ collectRunRecords, readSessionMeta }: LocateQuestionRunSettings): LocateQuestionRun =>
  async (payload: AskUserQuestionPayload): Promise<SessionRunLink | null> => {
    const [runs, meta]: [RunRecord[], SessionMeta | null] = await Promise.all([
      collectRunRecords(),
      // The name comes from the hook's request: one file name or nothing.
      isSafeSegment(payload.sessionId) ? readSessionMeta(payload.sessionId) : null,
    ]);
    return findSessionRun(runs, {
      claudeSessionId: payload.claudeSessionId,
      factoryId: meta?.factoryId,
      startedAt: meta?.startedAt,
    });
  };
