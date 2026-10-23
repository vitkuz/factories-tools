import type { AppLogger } from '../../../shared/types.js';
import type { SessionStartPayload } from '../chat.types.js';

export interface RecordSessionStartSettings {
  recordLink: (payload: SessionStartPayload) => Promise<boolean>;
  /** A chat already open on the session moves to the new transcript. */
  relink: (sessionId: string) => Promise<void>;
  logger?: AppLogger;
}

/** The SessionStart hook said where the transcript is: keep it, and move any open chat there. */
export const recordSessionStartFactory =
  ({ recordLink, relink, logger }: RecordSessionStartSettings) =>
  async (payload: SessionStartPayload): Promise<boolean> => {
    const recorded: boolean = await recordLink(payload);
    if (!recorded) {
      logger?.warn('session start: transcript path refused', { session: payload.sessionId });
      return false;
    }
    logger?.info('session start: transcript linked', {
      session: payload.sessionId,
      claudeSessionId: payload.claudeSessionId,
      source: payload.source,
    });
    await relink(payload.sessionId);
    return true;
  };
