import type { Request, Response } from 'express';
import { httpError } from '../../../shared/utils/http-error.utils.js';
import type { RemoveRunResult, RunParams, RunUsecases } from '../runs.types.js';

/** `DELETE /runs/:pipelineId/:runId`: 200 with where the run went, else why it stayed. */
export const removeRunControllerFactory =
  (usecases: Pick<RunUsecases, 'removeRun'>) =>
  async (_req: Request, res: Response): Promise<void> => {
    const { pipelineId, runId }: RunParams = res.locals.params as RunParams;
    const result: RemoveRunResult = await usecases.removeRun(pipelineId, runId);
    if (result.ok) {
      res.set('Cache-Control', 'no-store').json({ removed: result.removed });
      return;
    }
    if (result.reason === 'not-found') throw httpError(404, 'run not found');
    if (result.reason === 'refused') throw httpError(403, result.message);
    if (result.reason === 'live-session') {
      throw httpError(
        409,
        `the run is still live in session "${result.session}" — stop the session first`,
        { session: result.session },
      );
    }
    throw httpError(503, `cannot tell whether a session is still in the run: ${result.message}`);
  };
