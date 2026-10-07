import type { Request, Response } from 'express';
import { httpError } from '../../../shared/utils/http-error.utils.js';
import type { SessionUsecases, StopSessionPayload, StopSessionResult } from '../sessions.types.js';

export const stopSessionControllerFactory =
  (usecases: Pick<SessionUsecases, 'stopSession'>) =>
  async (_req: Request, res: Response): Promise<void> => {
    const { session }: StopSessionPayload = res.locals.body as StopSessionPayload;
    const result: StopSessionResult = await usecases.stopSession(session);
    if (result.ok) {
      res.json({ stopped: result.stopped });
      return;
    }
    if (result.reason === 'ambiguous') {
      throw httpError(
        409,
        `"${session}" is running ${result.sessions.length} times — stop one by its session name`,
        { sessions: result.sessions },
      );
    }
    throw httpError(404, `no running factory session named "${session}"`, {
      running: result.running,
    });
  };
