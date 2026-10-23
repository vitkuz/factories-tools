import path from 'node:path';
import type { AppLogger } from '../../../shared/types.js';
import type { FactorySession } from '../../sessions/sessions.types.js';
import type {
  LocateRemovableRunResult,
  RemoveRunResult,
  RunRecord,
  RunServices,
  SessionRunLink,
  SessionsRead,
} from '../runs.types.js';
import { findSessionRun } from '../runs.utils.js';

export interface RemoveRunSettings extends Pick<
  RunServices,
  'collectRunRecords' | 'locateRemovableRun' | 'moveRunToTrash'
> {
  /** The studio sessions alive in herdr right now. */
  listSessions: () => Promise<FactorySession[]>;
  workDir: string;
  logger?: AppLogger;
}

const relative =
  (workDir: string) =>
  (file: string): string =>
    path.relative(workDir, file).split(path.sep).join('/');

const isRun =
  (pipelineId: string, runId: string) =>
  (link: SessionRunLink | null): boolean =>
    link !== null && link.pipelineId === pipelineId && link.runId === runId;

/**
 * The live session still in the run, or `null`. A session is in a run by the same link a
 * question uses (`findSessionRun`): the Claude session id the recorder stamped, else the
 * started-after fallback for an unstamped run. A run whose state says RUNNING but whose
 * session is gone has no link here, so it is a dead run and may go.
 */
const liveSessionOf = (
  sessions: readonly FactorySession[],
  runs: readonly RunRecord[],
  pipelineId: string,
  runId: string,
): FactorySession | null =>
  sessions.find((session: FactorySession): boolean =>
    isRun(
      pipelineId,
      runId,
    )(
      findSessionRun(runs, {
        claudeSessionId: session.claudeSessionId,
        factoryId: session.factoryId,
        startedAt: session.startedAt,
      }),
    ),
  ) ?? null;

const readSessions = async (
  listSessions: () => Promise<FactorySession[]>,
): Promise<SessionsRead> => {
  try {
    return { ok: true, sessions: await listSessions() };
  } catch (error: unknown) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};

/** Find the run, make sure no live session is in it, move it to `run/.trash`. */
export const removeRunFactory =
  ({
    collectRunRecords,
    locateRemovableRun,
    moveRunToTrash,
    listSessions,
    workDir,
    logger,
  }: RemoveRunSettings) =>
  async (pipelineId: string, runId: string): Promise<RemoveRunResult> => {
    const located: LocateRemovableRunResult = await locateRemovableRun(pipelineId, runId);
    if (!located.ok) return located;

    const [runs, sessions]: [RunRecord[], SessionsRead] = await Promise.all([
      collectRunRecords(),
      readSessions(listSessions),
    ]);
    if (!sessions.ok) {
      logger?.warn('run not removed: the session list is unreadable', {
        pipelineId,
        runId,
        message: sessions.message,
      });
      return { ok: false, reason: 'sessions-unknown', message: sessions.message };
    }
    const live: FactorySession | null = liveSessionOf(sessions.sessions, runs, pipelineId, runId);
    if (live !== null) return { ok: false, reason: 'live-session', session: live.session };

    const trashed: string = await moveRunToTrash(located.run, runId);
    const toRelative: (file: string) => string = relative(workDir);
    return {
      ok: true,
      removed: {
        pipelineId,
        runId,
        from: toRelative(located.run.dir),
        trashedTo: toRelative(trashed),
      },
    };
  };
