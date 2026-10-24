import type { HttpError } from '../../../shared/types.js';
import { httpError } from '../../../shared/utils/http-error.utils.js';
import { WORKSPACES_FILE_LABEL } from '../workspaces.utils.js';

export const workspaceNotFound = (): HttpError => httpError(404, 'workspace not found');

/** A write over a file that cannot be read back would lose a hand edit: the person fixes it. */
export const workspacesFileUnreadable = (problem: string): HttpError =>
  httpError(
    409,
    `${WORKSPACES_FILE_LABEL} cannot be changed: ${problem} — fix or remove it by hand`,
  );
