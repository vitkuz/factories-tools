import { isAxiosError } from 'axios';
import { ZodError } from 'zod';

/**
 * Every failure of the adapter, as a value the screens can read: the API's own refusal
 * (`http`), a body that did not match its schema (`invalid`), or no answer at all.
 */
export type ApiError =
  | { kind: 'http'; status: number; message: string; details: unknown; requestId?: string }
  | { kind: 'invalid'; message: string; issues: string[] }
  | { kind: 'network'; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Zod issues as the API sends them (`details: [{ path, message }]`) → `"path: message"`. */
export const formatIssues = (details: unknown): string[] => {
  if (!Array.isArray(details)) return [];
  return details.flatMap((issue: unknown): string[] => {
    if (!isRecord(issue) || typeof issue.message !== 'string') return [];
    const path: string = Array.isArray(issue.path) ? issue.path.map(String).join('.') : '';
    return [path ? `${path}: ${issue.message}` : issue.message];
  });
};

const zodIssueLines = (error: ZodError): string[] =>
  error.issues.slice(0, 5).map((issue): string => {
    const path: string = issue.path.map(String).join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });

export const toApiError = (error: unknown): ApiError => {
  if (isAxiosError(error)) {
    const response = error.response;
    if (response) {
      const body: unknown = response.data;
      const message: string =
        isRecord(body) && typeof body.error === 'string' ? body.error : `HTTP ${response.status}`;
      const requestId: unknown = isRecord(body) ? body.requestId : undefined;
      return {
        kind: 'http',
        status: response.status,
        message,
        details: isRecord(body) ? body.details : undefined,
        requestId: typeof requestId === 'string' ? requestId : undefined,
      };
    }
    return { kind: 'network', message: error.message || 'the API is not answering' };
  }
  if (error instanceof ZodError) {
    return {
      kind: 'invalid',
      message: 'the API answered with an unexpected shape',
      issues: zodIssueLines(error),
    };
  }
  return { kind: 'network', message: error instanceof Error ? error.message : String(error) };
};

export const isApiError = (value: unknown): value is ApiError =>
  isRecord(value) &&
  (value.kind === 'http' || value.kind === 'invalid' || value.kind === 'network') &&
  typeof value.message === 'string';

/** One line for a screen: the message, and the first issue when there is one. */
export const describeApiError = (error: ApiError): string =>
  error.kind === 'invalid' && error.issues.length > 0
    ? `${error.message} (${error.issues[0]})`
    : error.message;
