import type { Request, Response } from 'express';
import type { ChatUsecases, SessionStartPayload } from '../chat.types.js';

/** The SessionStart hook's post. It never waits on anything a person does: the hook is fast. */
export const sessionStartControllerFactory =
  (usecases: Pick<ChatUsecases, 'recordSessionStart'>) =>
  async (_req: Request, res: Response): Promise<void> => {
    const recorded: boolean = await usecases.recordSessionStart(
      res.locals.body as SessionStartPayload,
    );
    res.json({ ok: recorded });
  };
