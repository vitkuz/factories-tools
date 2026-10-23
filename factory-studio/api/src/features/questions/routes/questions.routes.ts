import express, { Router, type RequestHandler } from 'express';
import { validateBody } from '../../../shared/middleware/validate.js';
import {
  answerQuestionControllerFactory,
  askUserQuestionControllerFactory,
  dismissQuestionControllerFactory,
  questionResolvedControllerFactory,
} from '../controllers/index.js';
import {
  answerQuestionPayloadSchema,
  askUserQuestionPayloadSchema,
  dismissQuestionPayloadSchema,
  questionResolvedPayloadSchema,
} from '../questions.schema.js';
import type { QuestionUsecases } from '../questions.types.js';

/**
 * The hook endpoints (called by `hooks/studio-question-hook.mjs`) and the REST mirror of the
 * WebSocket answer/dismiss. The API key is checked one level up.
 */
export const createQuestionsRoutes = (usecases: QuestionUsecases): Router => {
  const router: Router = Router();
  const jsonBody: RequestHandler = express.json({ limit: '1mb' });
  router.post(
    '/hooks/ask-user-question',
    jsonBody,
    validateBody(askUserQuestionPayloadSchema),
    askUserQuestionControllerFactory(usecases),
  );
  router.post(
    '/hooks/question-resolved',
    jsonBody,
    validateBody(questionResolvedPayloadSchema),
    questionResolvedControllerFactory(usecases),
  );
  router.post(
    '/sessions/answer',
    jsonBody,
    validateBody(answerQuestionPayloadSchema),
    answerQuestionControllerFactory(usecases),
  );
  router.post(
    '/sessions/dismiss',
    jsonBody,
    validateBody(dismissQuestionPayloadSchema),
    dismissQuestionControllerFactory(usecases),
  );
  return router;
};
