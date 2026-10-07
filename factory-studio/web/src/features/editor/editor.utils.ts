import { formatIssues, type ApiError } from '../../adapters/http/api-error.utils';
import type { Issue } from './lib/pipeline.types';

/** The Checks panel's issues as one line each, for a notice. */
export const issueLines = (issues: Issue[]): string[] =>
  issues.map((issue: Issue): string => `${issue.level} · ${issue.where}: ${issue.message}`);

export interface SaveFailure {
  message: string;
  issues: string[];
}

/** An API refusal of a save (E4) or a create (E4b), as the editor shows it. */
export const describeSaveFailure = (error: ApiError): SaveFailure => {
  if (error.kind === 'http' && error.status === 400)
    return { message: error.message, issues: formatIssues(error.details) };
  if (error.kind === 'http' && error.status === 404)
    return { message: 'pipeline not found on disk', issues: [] };
  if (error.kind === 'http' && error.status === 409)
    return { message: error.message, issues: formatIssues(error.details) };
  if (error.kind === 'http' && error.status === 413)
    return { message: 'document too large (2 MB is the limit)', issues: [] };
  if (error.kind === 'invalid') return { message: error.message, issues: error.issues };
  return { message: error.message, issues: [] };
};
