import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodSafeParseResult, ZodType } from 'zod';
import { httpError } from '../utils/http-error.utils.js';

/**
 * Parses the body with the schema and leaves the typed result on `res.locals.body`. The body
 * as Express parsed it stays on `res.locals.raw`: zod's output puts known keys first, and a
 * pipeline save must write the key order it received. A controller reads from `res.locals`
 * and never touches `req.body`.
 */
export const validateBody =
  <T>(schema: ZodType<T>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction): void => {
    const parsed: ZodSafeParseResult<T> = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      next(httpError(400, 'invalid request body', parsed.error.issues));
      return;
    }
    res.locals.body = parsed.data;
    res.locals.raw = req.body;
    next();
  };
