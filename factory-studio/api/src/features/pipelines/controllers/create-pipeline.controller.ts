import type { Request, Response } from 'express';
import { httpError } from '../../../shared/utils/http-error.utils.js';
import type {
  CreatePipelineResult,
  NewPipelineFile,
  PipelineUsecases,
} from '../pipelines.types.js';

export const createPipelineControllerFactory =
  (usecases: Pick<PipelineUsecases, 'createPipeline'>) =>
  async (_req: Request, res: Response): Promise<void> => {
    const body: NewPipelineFile = res.locals.body as NewPipelineFile;
    const raw: unknown = res.locals.raw;
    const result: CreatePipelineResult = await usecases.createPipeline(body, raw);
    if (!result.ok) {
      throw httpError(409, `"${body.id}" already exists on disk`, { existing: result.existing });
    }
    res.set('Cache-Control', 'no-store').status(201).json(result.created);
  };
