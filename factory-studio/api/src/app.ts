import express, { Router, type Express, type Request, type Response } from 'express';
import { createPipelinesRoutes } from './features/pipelines/index.js';
import type { PipelineUsecases } from './features/pipelines/pipelines.types.js';
import { createRunsRoutes } from './features/runs/index.js';
import type { RunUsecases } from './features/runs/runs.types.js';
import { createScriptsRoutes } from './features/scripts/index.js';
import type { ScriptUsecases } from './features/scripts/scripts.types.js';
import { createSessionsRoutes } from './features/sessions/index.js';
import type { SessionUsecases } from './features/sessions/sessions.types.js';
import { apiKeyMiddleware } from './shared/middleware/api-key.js';
import { errorMiddleware } from './shared/middleware/error.js';
import { noStoreMiddleware } from './shared/middleware/no-store.js';
import { notFoundMiddleware } from './shared/middleware/not-found.js';
import { requestLogMiddleware } from './shared/middleware/request-log.js';
import { staticAppMiddleware } from './shared/middleware/static-app.js';
import type { AppLogger } from './shared/types.js';

export interface AppSettings {
  /** `undefined`: every /api/v1 route is open on loopback (BR46). */
  apiKey?: string;
  /** `null` in tests that do not serve the app. */
  webDist: string | null;
  pipelines: PipelineUsecases;
  runs: RunUsecases;
  scripts: ScriptUsecases;
  sessions: SessionUsecases;
  logger: AppLogger;
}

export const API_PREFIX = '/api/v1';

/**
 * Express wiring, and nothing else. Everything the routes need arrives in `settings`, so a
 * test can build the whole app around a fake tmux client and a temp WORK_DIR. No CORS: the
 * app and the API share one origin. No app-wide body parser: each route that takes a body
 * attaches its own (JSON on the pipeline save and the session routes, raw text on the run
 * document PUT), so a JSON-typed document is never consumed before the text parser sees it.
 */
export const createApp = ({
  apiKey,
  webDist,
  pipelines,
  runs,
  scripts,
  sessions,
  logger,
}: AppSettings): Express => {
  const app: Express = express();
  app.disable('x-powered-by');
  app.use(requestLogMiddleware(logger));

  /** No key: a liveness check, and it says nothing but "up". */
  app.get('/health', (_req: Request, res: Response): void => {
    res.json({ ok: true });
  });

  const api: Router = Router();
  api.use(noStoreMiddleware);
  if (apiKey !== undefined) api.use(apiKeyMiddleware({ apiKey, logger }));
  api.use(createPipelinesRoutes(pipelines));
  api.use(createRunsRoutes(runs));
  api.use(createScriptsRoutes(scripts));
  api.use(createSessionsRoutes(sessions));
  app.use(API_PREFIX, api);

  // Every API route is registered above this line: a miss under /api is JSON, never a page.
  app.use('/api', notFoundMiddleware);
  if (webDist !== null) app.use(staticAppMiddleware({ webDist, logger }));
  app.use(notFoundMiddleware);
  app.use(errorMiddleware(logger));
  return app;
};
