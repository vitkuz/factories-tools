import { z } from 'zod';
import { runSegmentSchema } from '../runs/runs.schema.js';

/**
 * `/site/:pipelineId/:runId…` and `/zip/:pipelineId/:runId…`: each id is one run folder
 * name. A miss answers `404 run not found`, as E7 does for an id that is not one segment.
 */
export const siteParamsSchema = z.object({
  pipelineId: runSegmentSchema,
  runId: runSegmentSchema,
});
