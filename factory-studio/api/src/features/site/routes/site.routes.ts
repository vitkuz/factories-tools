import { Router } from 'express';
import type { ZipClient } from '../../../clients/zip/zip.types.js';
import {
  readSiteControllerFactory,
  siteHeadersMiddleware,
  zipFolderControllerFactory,
} from '../controllers/index.js';
import type { SiteUsecases } from '../site.types.js';

export interface SiteRoutesSettings {
  usecases: SiteUsecases;
  zip: ZipClient;
}

/**
 * E17 (a run folder as a site, for a new tab) and E18 (the folder as a zip). Read-only; GET
 * answers HEAD too. The `{/*path}` group is optional, so the run root matches.
 *
 * The preview is not sandboxed: a page runs on the Studio origin with the viewer's access.
 * Invariant kept for pages on other sites: they can send a GET, or a POST with a `text/plain`,
 * form or multipart body, to `/api/v1` without a preflight. No POST route may ever parse such
 * a body (they all take `express.json()`, which leaves it unparsed and the body check answers
 * 400), and no GET route may change anything.
 */
export const createSiteRoutes = ({ usecases, zip }: SiteRoutesSettings): Router => {
  const router: Router = Router();
  router.use('/site', siteHeadersMiddleware);
  router.use('/zip', siteHeadersMiddleware);
  router.get('/site/:pipelineId/:runId{/*path}', readSiteControllerFactory(usecases));
  router.get('/zip/:pipelineId/:runId{/*path}', zipFolderControllerFactory({ usecases, zip }));
  return router;
};
