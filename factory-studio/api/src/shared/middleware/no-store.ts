import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Everything under /api/v1 is live state read from disk or tmux: nothing may be cached. Set
 * first, so `res.sendFile` (which only fills the header when absent) keeps it too.
 */
export const noStoreMiddleware: RequestHandler = (
  _req: Request,
  res: Response,
  next: NextFunction,
): void => {
  res.set('Cache-Control', 'no-store');
  next();
};
