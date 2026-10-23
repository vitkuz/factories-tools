import { httpError } from '../../../shared/utils/http-error.utils.js';
import type { HttpError } from '../../../shared/types.js';
import type { ChatUnavailableReason } from '../chat.types.js';

/** 404 for a session herdr does not have, 409 for one whose transcript is not known yet. */
export const unavailableError = (reason: ChatUnavailableReason): HttpError =>
  reason === 'unknown-session'
    ? httpError(404, 'no such running session')
    : httpError(409, 'the session has no transcript yet', { reason });
