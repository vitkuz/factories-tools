import type { Response } from 'express';
import { httpError } from '../../../shared/utils/http-error.utils.js';
import type { QuestionActionResult } from '../questions.types.js';

/** `200 {ok:true}`, `404` for a prompt that is no longer pending, `400` for answers that do not fit. */
export const respondToAction = (res: Response, result: QuestionActionResult): void => {
  if (result.ok) {
    res.json({ ok: true });
    return;
  }
  if (result.reason === 'not-found') throw httpError(404, 'no such pending question');
  throw httpError(400, result.message);
};
