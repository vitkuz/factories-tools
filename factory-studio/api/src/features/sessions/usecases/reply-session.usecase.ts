import type { HerdrClient } from '../../../clients/herdr/herdr.types.js';
import type { FactorySession, ReplySessionResult } from '../sessions.types.js';

export interface ReplySessionSettings {
  herdr: HerdrClient;
  listSessions: () => Promise<FactorySession[]>;
}

/** For a session that is blocked without a hook question (a permission prompt, a plain ask). */
export const replySessionFactory =
  ({ herdr, listSessions }: ReplySessionSettings) =>
  async (sessionId: string, text: string): Promise<ReplySessionResult> => {
    const target: FactorySession | undefined = (await listSessions()).find(
      (session: FactorySession): boolean => session.session === sessionId,
    );
    if (!target?.paneId) return { ok: false, reason: 'not-found' };
    await herdr.sendText(target.paneId, text);
    await herdr.sendKeys(target.paneId, ['Enter']);
    return { ok: true };
  };
