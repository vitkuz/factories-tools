import type { Request, Response } from 'express';
import type { ZodSafeParseResult } from 'zod';
import { httpError } from '../../../shared/utils/http-error.utils.js';
import { siteParamsSchema } from '../site.schema.js';
import type { ReadSiteResult, SiteParams, SiteUsecases } from '../site.types.js';
import { sendSiteAnswer, siteRawPath } from './site-http.utils.js';

/** E17 `GET /site/:pipelineId/:runId{/*path}`: an id that is not one run folder name is no run. */
export const readSiteControllerFactory =
  (usecases: Pick<SiteUsecases, 'readSite'>) =>
  async (req: Request, res: Response): Promise<void> => {
    const params: ZodSafeParseResult<SiteParams> = siteParamsSchema.safeParse(req.params);
    if (!params.success) throw httpError(404, 'run not found');
    const { pipelineId, runId }: SiteParams = params.data;
    const result: ReadSiteResult = await usecases.readSite(
      pipelineId,
      runId,
      siteRawPath(req, 'site'),
    );
    if (!result.ok) throw httpError(404, 'run not found');
    sendSiteAnswer(req, res, result.answer, `${pipelineId}/${runId}`);
  };
