import type { Request, Response } from 'express';
import type { QuestionUsecases } from '../questions.types.js';

/** The questions waiting for a person, in full: what `hello` carries, for a plain HTTP read. */
export const listQuestionsControllerFactory =
  (usecases: Pick<QuestionUsecases, 'listPending'>) =>
  (_req: Request, res: Response): void => {
    const pending = usecases.listPending();
    res.json({ count: pending.length, pending });
  };
