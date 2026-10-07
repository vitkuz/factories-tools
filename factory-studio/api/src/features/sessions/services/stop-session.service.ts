import type { TmuxClient } from '../../../clients/tmux/tmux.types.js';
import type { AppLogger } from '../../../shared/types.js';
import type { FactorySession, StopSessionResult } from '../sessions.types.js';
import { matchesFactoryId } from '../sessions.utils.js';

export interface StopSessionSettings {
  tmux: TmuxClient;
  listSessions: () => Promise<FactorySession[]>;
  logger?: AppLogger;
}

/**
 * Stops one session, given its full name or its factory id. A full name is always exact. An
 * id with several live sessions is refused with the list rather than guessed at — the caller
 * picks one and sends its name.
 */
export const stopSessionFactory =
  ({ tmux, listSessions, logger }: StopSessionSettings) =>
  async (target: string): Promise<StopSessionResult> => {
    const running: FactorySession[] = await listSessions();

    const byName: FactorySession | undefined = running.find(
      (session: FactorySession): boolean => session.session === target,
    );
    const byId: FactorySession[] = byName
      ? []
      : running.filter((session: FactorySession): boolean => matchesFactoryId(session, target));

    if (!byName && byId.length > 1) return { ok: false, reason: 'ambiguous', sessions: byId };

    const chosen: FactorySession | undefined = byName ?? byId[0];
    if (!chosen) {
      return {
        ok: false,
        reason: 'not-found',
        running: running.map((session: FactorySession): string => session.session),
      };
    }

    const killed: boolean = await tmux.killSession(chosen.session);
    if (!killed) {
      // Gone between the list and the kill. Same outcome for the caller: it is not running.
      logger?.warn('session vanished before it could be stopped', { session: chosen.session });
    }
    logger?.info('factory session stopped', { session: chosen.session, target });
    return { ok: true, stopped: chosen };
  };
