import type { Request, Response } from 'express';
import { sendDocumentAnswer } from '../../../shared/middleware/send-document.js';
import { httpError } from '../../../shared/utils/http-error.utils.js';
import { rawPathAfter } from '../../documents/documents.http.utils.js';
import type { ReadRunDocumentResult, RunUsecases } from '../runs.types.js';

/** The raw remainder comes after `/runs/<pipelineId>/<runId>/`, so the marker is built per request. */
export const runDocMarker = (req: Request): string =>
  `/runs/${encodeURIComponent(String(req.params.pipelineId ?? ''))}/${encodeURIComponent(String(req.params.runId ?? ''))}/`;

/** The URL as the client sent it may hold the ids already encoded; try both spellings. */
export const runDocRawPath = (req: Request): string => {
  const encoded: string = rawPathAfter(req.originalUrl, runDocMarker(req));
  if (encoded !== '') return encoded;
  return rawPathAfter(
    req.originalUrl,
    `/runs/${String(req.params.pipelineId ?? '')}/${String(req.params.runId ?? '')}/`,
  );
};

export const readRunDocumentControllerFactory =
  (usecases: Pick<RunUsecases, 'readRunDocument'>) =>
  async (req: Request, res: Response): Promise<void> => {
    const pipelineId: string = String(req.params.pipelineId ?? '');
    const runId: string = String(req.params.runId ?? '');
    const result: ReadRunDocumentResult = await usecases.readRunDocument(
      pipelineId,
      runId,
      runDocRawPath(req),
    );
    if (!result.ok) throw httpError(404, 'run not found');
    sendDocumentAnswer(req, res, result.answer);
  };
