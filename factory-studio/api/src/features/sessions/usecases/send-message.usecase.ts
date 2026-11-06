import type { HerdrClient, PromptAgentResult } from '../../../clients/herdr/herdr.types.js';
import type { AppLogger } from '../../../shared/types.js';
import type { Broadcast } from '../../questions/questions.types.js';
import type { FactorySession, SendMessageResult } from '../sessions.types.js';
import { acceptsMessage } from '../sessions.utils.js';

export interface SendMessageSettings {
  herdr: Pick<HerdrClient, 'promptAgent'>;
  /** A fresh herdr listing, every time: the status the gate reads is now's, not a poll ago's. */
  listSessions: () => Promise<FactorySession[]>;
  /** Does the studio hold a question of this session that a person has not answered yet? */
  hasPendingQuestion: (sessionId: string) => boolean;
  /** `session.status` goes out the moment Claude is seen working, ahead of the next poll. */
  broadcast: Broadcast;
  /** How long to wait for herdr to see the agent working after the submission (10 s). */
  waitMs?: number;
  logger?: AppLogger;
}

/**
 * A chat message to a session that sits at its prompt, through herdr's `agent prompt`. The
 * server is the gate, not the app: the session must be listed, idle or done by a listing
 * taken now, free of a pending studio question, and not already being sent to. One send per
 * session at a time; the set of sessions in flight is replaced, never edited.
 */
export const sendMessageFactory = ({
  herdr,
  listSessions,
  hasPendingQuestion,
  broadcast,
  waitMs = 10_000,
  logger,
}: SendMessageSettings) => {
  let inFlight: ReadonlySet<string> = new Set();
  const mark = (sessionId: string, on: boolean): void => {
    const next: Set<string> = new Set(inFlight);
    if (on) next.add(sessionId);
    else next.delete(sessionId);
    inFlight = next;
  };

  return async (sessionId: string, text: string): Promise<SendMessageResult> => {
    if (inFlight.has(sessionId)) return { ok: false, reason: 'in-flight' };
    mark(sessionId, true);
    try {
      const target: FactorySession | undefined = (await listSessions()).find(
        (session: FactorySession): boolean => session.session === sessionId,
      );
      if (!target?.paneId) return { ok: false, reason: 'not-found' };
      if (hasPendingQuestion(sessionId)) return { ok: false, reason: 'question' };
      if (!acceptsMessage(target.status)) {
        return { ok: false, reason: 'not-idle', status: target.status ?? 'unknown' };
      }
      const prompted: PromptAgentResult = await herdr.promptAgent(target.paneId, text, waitMs);
      if (!prompted.ok) {
        logger?.warn('session message refused by herdr', {
          session: sessionId,
          code: prompted.code,
        });
        return { ok: false, reason: 'herdr', code: prompted.code, message: prompted.message };
      }
      if (prompted.started) broadcast({ type: 'session.status', sessionId, status: 'working' });
      logger?.info('session message sent', {
        session: sessionId,
        chars: text.length,
        started: prompted.started,
      });
      return { ok: true, started: prompted.started };
    } finally {
      mark(sessionId, false);
    }
  };
};
