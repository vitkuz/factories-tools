import type { TmuxClient, TmuxSessionInfo } from '../../../clients/tmux/tmux.types.js';
import type { FactorySession } from '../sessions.types.js';
import { SESSION_LABELS, isFactorySession, toFactorySession } from '../sessions.utils.js';

export interface ListSessionsSettings {
  tmux: TmuxClient;
  now?: () => Date;
}

/** Every `factory-*` session on the tmux server, oldest first. Other sessions are not ours. */
export const listSessionsFactory =
  ({ tmux, now = (): Date => new Date() }: ListSessionsSettings) =>
  async (): Promise<FactorySession[]> => {
    const all: TmuxSessionInfo[] = await tmux.listSessions(SESSION_LABELS);
    const at: Date = now();
    return all
      .filter((info: TmuxSessionInfo): boolean => isFactorySession(info.name))
      .map((info: TmuxSessionInfo): FactorySession => toFactorySession(info, at))
      .sort((a: FactorySession, b: FactorySession): number => b.ageSeconds - a.ageSeconds);
  };
