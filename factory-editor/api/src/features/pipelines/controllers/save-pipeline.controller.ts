import type { Request, Response } from 'express';
import { httpError } from '../../../shared/utils/http-error.utils.js';
import type {
  PipelineFile,
  PipelineUsecases,
  SavePipelineResult,
  SavedResponse,
} from '../pipelines.types.js';

export const savePipelineControllerFactory =
  (usecases: Pick<PipelineUsecases, 'savePipeline'>) =>
  async (req: Request, res: Response): Promise<void> => {
    const id: string = String(req.params.id ?? '');
    const body: PipelineFile = res.locals.body as PipelineFile;
    const raw: unknown = res.locals.raw;
    const result: SavePipelineResult = await usecases.savePipeline(id, body, raw);
    if (!result.ok) {
      if (result.reason === 'id-mismatch') {
        throw httpError(400, 'invalid request body', [
          { path: ['id'], message: 'id must equal the id in the path' },
        ]);
      }
      throw httpError(404, 'pipeline not found');
    }
    const saved: SavedResponse = { kind: 'saved', bytes: result.bytes };
    res.set('Cache-Control', 'no-store').status(200).json(saved);
  };
