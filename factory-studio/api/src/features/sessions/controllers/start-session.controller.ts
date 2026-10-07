import type { Request, Response } from 'express';
import { httpError } from '../../../shared/utils/http-error.utils.js';
import type {
  SessionUsecases,
  StartFactoryResult,
  StartSessionPayload,
} from '../sessions.types.js';

/**
 * Turns a start result into an HTTP response. Knows about status codes; knows nothing
 * about tmux. The validated body is on `res.locals.body`, put there by the route.
 */
export const respondToStart = (res: Response, result: StartFactoryResult): void => {
  if (result.ok) {
    res.status(201).json(result.run);
    return;
  }
  if (result.reason === 'unknown-factory') {
    throw httpError(404, 'no such factory skill on disk', { available: result.available });
  }
  throw httpError(
    502,
    `the ${result.harness} session exited immediately — is ${result.harness} on the PATH of the API's tmux server?`,
    { session: result.session, harness: result.harness },
  );
};

export const startSessionControllerFactory =
  (usecases: Pick<SessionUsecases, 'startFactorySession'>) =>
  async (_req: Request, res: Response): Promise<void> => {
    const payload: StartSessionPayload = res.locals.body as StartSessionPayload;
    const result: StartFactoryResult = await usecases.startFactorySession(payload);
    respondToStart(res, result);
  };
