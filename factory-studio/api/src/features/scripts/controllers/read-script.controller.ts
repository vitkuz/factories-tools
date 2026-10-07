import type { Request, Response } from 'express';
import type { ZodSafeParseResult } from 'zod';
import { sendDocumentAnswer } from '../../../shared/middleware/send-document.js';
import { httpError } from '../../../shared/utils/http-error.utils.js';
import { rawPathAfter } from '../../documents/documents.http.utils.js';
import type { DocumentAnswer } from '../../documents/documents.types.js';
import { scriptRawPathSchema } from '../scripts.schema.js';
import type { ScriptUsecases } from '../scripts.types.js';

export const SCRIPTS_MARKER = '/scripts/';

export const readScriptControllerFactory =
  (usecases: Pick<ScriptUsecases, 'readScript'>) =>
  async (req: Request, res: Response): Promise<void> => {
    const raw: ZodSafeParseResult<string> = scriptRawPathSchema.safeParse(
      rawPathAfter(req.originalUrl, SCRIPTS_MARKER),
    );
    if (!raw.success) throw httpError(400, 'invalid script path', raw.error.issues);
    const answer: DocumentAnswer = await usecases.readScript(raw.data);
    sendDocumentAnswer(req, res, answer);
  };
