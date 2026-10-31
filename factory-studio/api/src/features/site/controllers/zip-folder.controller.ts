import type { Request, Response } from 'express';
import type { ZodSafeParseResult } from 'zod';
import type { ZipClient } from '../../../clients/zip/zip.types.js';
import { httpError } from '../../../shared/utils/http-error.utils.js';
import { siteParamsSchema } from '../site.schema.js';
import type { SiteParams, SiteUsecases, ZipFolderResult } from '../site.types.js';
import { sendZip, siteRawPath } from './site-http.utils.js';

export interface ZipFolderControllerSettings {
  usecases: Pick<SiteUsecases, 'zipFolder'>;
  zip: ZipClient;
}

/** E18 `GET /zip/:pipelineId/:runId{/*path}`: the folder as a streamed zip, or a JSON refusal. */
export const zipFolderControllerFactory =
  ({ usecases, zip }: ZipFolderControllerSettings) =>
  async (req: Request, res: Response): Promise<void> => {
    const params: ZodSafeParseResult<SiteParams> = siteParamsSchema.safeParse(req.params);
    if (!params.success) throw httpError(404, 'run not found');
    const { pipelineId, runId }: SiteParams = params.data;
    // The run root named without its `/` is still the run root: a download has no relative links.
    const result: ZipFolderResult = await usecases.zipFolder(
      pipelineId,
      runId,
      siteRawPath(req, 'zip') ?? '',
    );
    if (!result.ok) throw httpError(404, 'run not found');
    if (!result.plan.ok)
      throw httpError(result.plan.status, result.plan.error, result.plan.details);
    sendZip(req, res, result.plan, zip);
  };
