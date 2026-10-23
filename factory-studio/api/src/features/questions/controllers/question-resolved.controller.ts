import type { Request, Response } from 'express';
import type { QuestionResolvedPayload, QuestionUsecases } from '../questions.types.js';

export const questionResolvedControllerFactory =
  (usecases: Pick<QuestionUsecases, 'resolveQuestion'>) =>
  (_req: Request, res: Response): void => {
    usecases.resolveQuestion(res.locals.body as QuestionResolvedPayload);
    res.json({ ok: true });
  };
