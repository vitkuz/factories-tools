import type { AppLogger } from '../../../shared/types.js';
import type { Broadcast } from '../../questions/questions.types.js';
import type { FactorySession, SessionStatus } from '../sessions.types.js';

export interface PollSessionStatusSettings {
  listSessions: () => Promise<FactorySession[]>;
  broadcast: Broadcast;
  intervalMs?: number;
  /** Every successful poll, with the whole list: the live chat ends tails of gone sessions. */
  onSessions?: (sessions: readonly FactorySession[]) => Promise<void> | void;
  logger?: AppLogger;
}

export interface SessionStatusPoller {
  start: () => void;
  stop: () => void;
  /** One poll, awaited: broadcasts every session whose status differs from the last poll. */
  tick: () => Promise<void>;
}

/** Sessions whose status is new or changed against `previous`. Pure. */
export const changedStatuses = (
  previous: ReadonlyMap<string, SessionStatus>,
  sessions: readonly FactorySession[],
): FactorySession[] =>
  sessions.filter(
    (session: FactorySession): boolean =>
      previous.get(session.session) !== (session.status ?? 'unknown'),
  );

/**
 * Diffs herdr's agent status every `intervalMs` (2 s) and broadcasts `session.status` for each
 * change. The map it diffs against is replaced, never edited, after every poll.
 */
export const pollSessionStatusFactory = ({
  listSessions,
  broadcast,
  intervalMs = 2000,
  onSessions,
  logger,
}: PollSessionStatusSettings): SessionStatusPoller => {
  let last: ReadonlyMap<string, SessionStatus> = new Map();
  let timer: NodeJS.Timeout | undefined;

  const tick = async (): Promise<void> => {
    try {
      const sessions: FactorySession[] = await listSessions();
      for (const session of changedStatuses(last, sessions)) {
        broadcast({
          type: 'session.status',
          sessionId: session.session,
          status: session.status ?? 'unknown',
        });
      }
      last = new Map(
        sessions.map((session: FactorySession): [string, SessionStatus] => [
          session.session,
          session.status ?? 'unknown',
        ]),
      );
      await onSessions?.(sessions);
    } catch (error: unknown) {
      logger?.warn('status poll failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return {
    tick,
    start: (): void => {
      if (timer) return;
      timer = setInterval((): void => void tick(), intervalMs);
      timer.unref();
    },
    stop: (): void => {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
};
