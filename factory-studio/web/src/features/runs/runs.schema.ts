import { z } from 'zod';

/**
 * The run list (E6) is parsed by the dashboard's own schemas, copied under `lib/`. The
 * envelope is checked as a whole; each run record is checked on its own so one broken
 * `state.json` hides that run and not the list (see `parseLivePayload`).
 */
export {
  dashboardEnvelopeSchema,
  runRecordSchema,
  dashboardDataSchema,
  describeIssues,
  type ParseIssue,
} from './lib/dashboard.schema';

/** E15's answer: where the removed run went. Paths are relative to the work dir. */
export const removedRunSchema = z.object({
  removed: z.object({
    pipelineId: z.string(),
    runId: z.string(),
    from: z.string(),
    trashedTo: z.string(),
  }),
});
