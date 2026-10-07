import type { Request, Response } from 'express';
import { sendDocumentAnswer } from '../../../shared/middleware/send-document.js';
import { httpError } from '../../../shared/utils/http-error.utils.js';
import type { PipelineUsecases, ReadKnowledgeResult } from '../pipelines.types.js';
import { rawPathAfter } from '../../documents/documents.http.utils.js';

export const KNOWLEDGE_MARKER = '/knowledge/';

export const readKnowledgeControllerFactory =
  (usecases: Pick<PipelineUsecases, 'readKnowledgeDocument'>) =>
  async (req: Request, res: Response): Promise<void> => {
    const id: string = String(req.params.id ?? '');
    const rawPath: string = rawPathAfter(req.originalUrl, KNOWLEDGE_MARKER);
    const result: ReadKnowledgeResult = await usecases.readKnowledgeDocument(id, rawPath);
    if (!result.ok) throw httpError(404, 'pipeline not found');
    sendDocumentAnswer(req, res, result.answer);
  };
