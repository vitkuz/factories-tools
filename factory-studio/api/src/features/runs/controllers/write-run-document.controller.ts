import type { Request, Response } from 'express';
import { httpError } from '../../../shared/utils/http-error.utils.js';
import type { SavedResponse } from '../../pipelines/pipelines.types.js';
import { runDocRawPath } from './read-run-document.controller.js';
import type { RunUsecases, WriteRunDocumentResult } from '../runs.types.js';

export const writeRunDocumentControllerFactory =
  (usecases: Pick<RunUsecases, 'writeRunDocument'>) =>
  async (req: Request, res: Response): Promise<void> => {
    const pipelineId: string = String(req.params.pipelineId ?? '');
    const runId: string = String(req.params.runId ?? '');
    // The one place a controller reads `req.body`: the body *is* the document, left there as
    // a string by `express.text` on this route, not a payload with a schema to validate.
    const text: string = typeof req.body === 'string' ? req.body : '';
    const result: WriteRunDocumentResult = await usecases.writeRunDocument(
      pipelineId,
      runId,
      runDocRawPath(req),
      text,
    );
    if (!result.ok) throw httpError(404, 'run not found');
    if (result.answer.kind === 'refused')
      throw httpError(result.answer.status, result.answer.error);
    const saved: SavedResponse = { kind: 'saved', bytes: result.answer.bytes };
    res.set('Cache-Control', 'no-store').status(200).json(saved);
  };
