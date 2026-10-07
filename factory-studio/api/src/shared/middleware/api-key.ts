import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AppLogger } from '../types.js';
import { httpError } from '../utils/http-error.utils.js';

export const API_KEY_HEADER = 'x-api-key';

export interface ApiKeySettings {
  apiKey: string;
  logger?: AppLogger;
}

/** Hashing both sides first gives `timingSafeEqual` equal lengths whatever was presented. */
const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

export const keysMatch = (presented: string, expected: string): boolean =>
  timingSafeEqual(digest(presented), digest(expected));

const readHeader = (req: Request): string | undefined => {
  const raw: string | string[] | undefined = req.headers[API_KEY_HEADER];
  const value: string | undefined = Array.isArray(raw) ? raw[0] : raw;
  return value !== undefined && value !== '' ? value : undefined;
};

/**
 * The one lock on the door, applied only when a key is configured. Missing or wrong is
 * `401 unauthorized` either way; the log line says which and never what was presented.
 */
export const apiKeyMiddleware =
  ({ apiKey, logger }: ApiKeySettings): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const presented: string | undefined = readHeader(req);
    if (presented === undefined) {
      logger?.warn('rejected: no api key', { ip: req.ip, method: req.method, path: req.path });
      next(httpError(401, 'unauthorized'));
      return;
    }
    if (!keysMatch(presented, apiKey)) {
      logger?.warn('rejected: wrong api key', { ip: req.ip, method: req.method, path: req.path });
      next(httpError(401, 'unauthorized'));
      return;
    }
    next();
  };
