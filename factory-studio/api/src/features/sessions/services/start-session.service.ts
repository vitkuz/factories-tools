import { setTimeout as sleep } from 'node:timers/promises';
import type { TmuxClient } from '../../../clients/tmux/tmux.types.js';
import type { AppLogger } from '../../../shared/types.js';
import type { StartSessionArgs } from '../sessions.types.js';
import { LABEL_FACTORY_ID, LABEL_HARNESS } from '../sessions.utils.js';

export interface StartSessionSettings {
  tmux: TmuxClient;
  /** How long the session must survive before it counts as started. */
  graceMs: number;
  logger?: AppLogger;
}

/**
 * Starts the session and waits a moment to see whether it stayed up. A harness that is not on
 * PATH, or one that rejects its flags, exits in well under a second — and without this check
 * a start would report a session that was already gone.
 *
 * `true` when the session is still alive after the grace period.
 */
export const startSessionFactory =
  ({ tmux, graceMs, logger }: StartSessionSettings) =>
  async ({ session, factoryId, harness, command, workDir }: StartSessionArgs): Promise<boolean> => {
    await tmux.newSession({
      name: session,
      cwd: workDir,
      command,
      labels: { [LABEL_HARNESS]: harness, [LABEL_FACTORY_ID]: factoryId },
    });
    if (graceMs > 0) await sleep(graceMs);
    const alive: boolean = await tmux.hasSession(session);
    if (!alive) logger?.warn('session exited inside the grace period', { session, harness });
    return alive;
  };
