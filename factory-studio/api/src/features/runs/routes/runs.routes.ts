import express, { Router } from 'express';
import { validateParams } from '../../../shared/middleware/validate.js';
import { MAX_DOCUMENT_BYTES } from '../../documents/documents.utils.js';
import {
  listRunsControllerFactory,
  readRunDocumentControllerFactory,
  removeRunControllerFactory,
  writeRunDocumentControllerFactory,
} from '../controllers/index.js';
import { runParamsSchema } from '../runs.schema.js';
import type { RunUsecases } from '../runs.types.js';

/**
 * E6–E8. The PUT reads any content type as text, at most 2 MB: past that the parser raises
 * `entity.too.large`, which the error edge maps to 413 after draining the request. This text
 * parser is the first parser the request meets (there is no app-wide JSON parser), so a body
 * sent as `application/json` lands on disk byte for byte, malformed or not. The DELETE moves
 * the whole run to `run/.trash`; its ids are checked by schema before anything reads the disk.
 */
export const createRunsRoutes = (usecases: RunUsecases): Router => {
  const router: Router = Router();
  router.get('/runs', listRunsControllerFactory(usecases));
  router.get('/runs/:pipelineId/:runId/*path', readRunDocumentControllerFactory(usecases));
  router.put(
    '/runs/:pipelineId/:runId/*path',
    express.text({ type: (): boolean => true, limit: MAX_DOCUMENT_BYTES }),
    writeRunDocumentControllerFactory(usecases),
  );
  router.delete(
    '/runs/:pipelineId/:runId',
    validateParams(runParamsSchema),
    removeRunControllerFactory(usecases),
  );
  return router;
};
