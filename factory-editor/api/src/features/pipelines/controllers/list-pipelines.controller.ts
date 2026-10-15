import type { Request, Response } from 'express';
import type { PipelineListResponse, PipelineUsecases } from '../pipelines.types.js';

export const listPipelinesControllerFactory =
  (usecases: Pick<PipelineUsecases, 'listPipelines'>) =>
  async (_req: Request, res: Response): Promise<void> => {
    const body: PipelineListResponse = await usecases.listPipelines();
    res.set('Cache-Control', 'no-store').json(body);
  };
