import type { Request, Response } from 'express';
import { httpError } from '../../../shared/utils/http-error.utils.js';
import type { PipelineUsecases, ReadPipelineResult } from '../pipelines.types.js';

/**
 * The file's own bytes, so `curl` output and the file on disk are identical. Dotfiles must be
 * allowed: the path runs through `.claude/`, which `send` would otherwise refuse as hidden.
 */
export const readPipelineControllerFactory =
  (usecases: Pick<PipelineUsecases, 'readPipeline'>) =>
  async (req: Request, res: Response): Promise<void> => {
    const id: string = String(req.params.id ?? '');
    const result: ReadPipelineResult = await usecases.readPipeline(id);
    if (!result.ok) throw httpError(404, 'pipeline not found');
    res
      .type('application/json')
      .set('Cache-Control', 'no-store')
      .sendFile(result.file, { dotfiles: 'allow' });
  };
