import fs from 'node:fs';
import path from 'node:path';
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import type { AppLogger } from '../types.js';

export interface StaticAppSettings {
  webDist: string;
  logger: AppLogger;
}

const isPageRequest = (req: Request): boolean =>
  (req.method === 'GET' || req.method === 'HEAD') && !req.path.startsWith('/api');

/**
 * The built app: static assets from `webDist`, and its `index.html` for any other `GET`
 * outside `/api`, so a client-side route survives a reload. Mounted after the API, so a
 * missing document always answers JSON. Without a build there is a 503 that says what to run.
 */
export const staticAppMiddleware = ({ webDist, logger }: StaticAppSettings): RequestHandler[] => {
  const indexFile: string = path.join(webDist, 'index.html');
  const built: boolean = fs.existsSync(indexFile);
  if (!built) logger.warn('app not built: GET / answers 503 until web/dist exists', { webDist });

  const assets: RequestHandler = express.static(webDist, {
    index: 'index.html',
    fallthrough: true,
  });

  const fallback: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
    if (!isPageRequest(req)) {
      next();
      return;
    }
    if (!built) {
      res.status(503).json({ error: 'app not built: run npm run build -w web' });
      return;
    }
    res.sendFile(indexFile, { dotfiles: 'allow' });
  };

  return [assets, fallback];
};
