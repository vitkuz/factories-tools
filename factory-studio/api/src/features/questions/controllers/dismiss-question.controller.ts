import type { Request, Response } from 'express';
import type { DismissQuestionPayload, QuestionUsecases } from '../questions.types.js';
import { respondToAction } from './respond-to-action.utils.js';

export const dismissQuestionControllerFactory =
  (usecases: Pick<QuestionUsecases, 'dismissQuestion'>) =>
  (_req: Request, res: Response): void => {
    respondToAction(res, usecases.dismissQuestion(res.locals.body as DismissQuestionPayload));
  };
