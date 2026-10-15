import type { Request, RequestHandler, Response } from 'express';

/** JSON, never the app's page: mounted under `/api` and again at the very end. */
export const notFoundMiddleware: RequestHandler = (_req: Request, res: Response): void => {
  res.status(404).json({ error: 'not found' });
};
