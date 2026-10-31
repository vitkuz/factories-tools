import type { Request, Response } from 'express';
import type { SystemMemoryResponse, SystemUsecases } from '../system.types.js';

/** `GET /system/memory`: always 200, a fresh reading every time. */
export const readMemoryControllerFactory =
  (usecases: Pick<SystemUsecases, 'readMemory'>) =>
  async (_req: Request, res: Response): Promise<void> => {
    const payload: SystemMemoryResponse = await usecases.readMemory();
    res.set('Cache-Control', 'no-store').json(payload);
  };
