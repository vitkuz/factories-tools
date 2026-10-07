import type { HttpError } from '../types.js';

export const httpError = (status: number, message: string, details?: unknown): HttpError => ({
  httpError: true,
  status,
  message,
  ...(details === undefined ? {} : { details }),
});

export const isHttpError = (value: unknown): value is HttpError =>
  typeof value === 'object' &&
  value !== null &&
  (value as { httpError?: unknown }).httpError === true &&
  typeof (value as { status?: unknown }).status === 'number';
