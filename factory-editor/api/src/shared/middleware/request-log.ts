import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AppLogger } from '../types.js';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * One id per request, echoed in the response header and in every log line about it, so a
 * caller's complaint can be matched to what the server saw.
 */
export const requestLogMiddleware =
  (logger: AppLogger): RequestHandler =>
  (req: Request, res: Response, next: NextFunction): void => {
    const requestId: string = uuidv4();
    const startedAt: number = Date.now();
    res.locals.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    res.on('finish', (): void => {
      logger.info('request', {
        requestId,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        ms: Date.now() - startedAt,
        ip: req.ip,
      });
    });
    next();
  };
