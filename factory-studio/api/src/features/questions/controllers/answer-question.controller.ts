import type { Request, Response } from 'express';
import type { AnswerQuestionPayload, QuestionUsecases } from '../questions.types.js';
import { respondToAction } from './respond-to-action.utils.js';

export const answerQuestionControllerFactory =
  (usecases: Pick<QuestionUsecases, 'answerQuestion'>) =>
  (_req: Request, res: Response): void => {
    respondToAction(res, usecases.answerQuestion(res.locals.body as AnswerQuestionPayload));
  };
