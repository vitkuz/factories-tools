import type { Request, Response } from 'express';
import type { FactorySession, SessionUsecases } from '../sessions.types.js';

export const listSessionsControllerFactory =
  (usecases: Pick<SessionUsecases, 'listSessions'>) =>
  async (_req: Request, res: Response): Promise<void> => {
    const sessions: FactorySession[] = await usecases.listSessions();
    res.set('Cache-Control', 'no-store').json({ count: sessions.length, sessions });
  };
