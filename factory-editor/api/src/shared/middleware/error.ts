import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import type { AppLogger } from '../types.js';
import { isHttpError } from '../utils/http-error.utils.js';

interface ErrorBody {
  error: string;
  requestId?: string;
  details?: unknown;
}

const hasType = (error: unknown, type: string): boolean =>
  typeof error === 'object' && error !== null && (error as { type?: unknown }).type === type;

/** Express's body parser attaches these to a malformed JSON body. */
const isBodyParseError = (error: unknown): error is { status: number; message: string } =>
  hasType(error, 'entity.parse.failed');

/** ...and this one to a body past the parser's limit (2 MB here). */
const isTooLargeError = (error: unknown): boolean => hasType(error, 'entity.too.large');

/**
 * The last handler. Known shapes get their status; anything else is a 500 with the request
 * id and a full log line, and the caller never sees a stack.
 */
export const errorMiddleware =
  (logger: AppLogger): ErrorRequestHandler =>
  (error: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    const requestId: string | undefined = res.locals.requestId as string | undefined;

    if (isHttpError(error)) {
      const body: ErrorBody = { error: error.message, requestId, details: error.details };
      res.status(error.status).json(body);
      return;
    }
    if (error instanceof ZodError) {
      res.status(400).json({ error: 'invalid request', requestId, details: error.issues });
      return;
    }
    if (error instanceof URIError) {
      // The router decodes route params before any handler runs; a bad %-escape lands here.
      res.status(400).json({ error: 'bad encoding', requestId });
      return;
    }
    if (isTooLargeError(error)) {
      res.status(413).json({ error: 'document too large', requestId });
      return;
    }
    if (isBodyParseError(error)) {
      res.status(400).json({ error: `malformed JSON body: ${error.message}`, requestId });
      return;
    }

    logger.error('unhandled error', {
      requestId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'internal error', requestId });
  };
