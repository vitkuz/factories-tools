import type { Request, Response } from 'express';
import type { AskUserQuestionPayload, HookOutcome, QuestionUsecases } from '../questions.types.js';

/**
 * The long poll the hook blocks on. A hook that goes away (killed, timed out, answered in the
 * terminal) closes the socket before the response is written: that aborts the wait.
 */
export const askUserQuestionControllerFactory =
  (usecases: Pick<QuestionUsecases, 'registerQuestion'>) =>
  async (_req: Request, res: Response): Promise<void> => {
    const payload: AskUserQuestionPayload = res.locals.body as AskUserQuestionPayload;
    const gone: AbortController = new AbortController();
    res.on('close', (): void => {
      if (!res.writableEnded) gone.abort();
    });
    const outcome: HookOutcome = await usecases.registerQuestion(payload, gone.signal);
    if (!res.writableEnded && !res.destroyed) res.json(outcome);
  };
