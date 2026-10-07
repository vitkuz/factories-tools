import type { Request, Response } from 'express';
import type { RunUsecases, RunsPayload } from '../runs.types.js';

export const listRunsControllerFactory =
  (usecases: Pick<RunUsecases, 'listRuns'>) =>
  async (_req: Request, res: Response): Promise<void> => {
    const payload: RunsPayload = await usecases.listRuns();
    res.set('Cache-Control', 'no-store').json(payload);
  };
