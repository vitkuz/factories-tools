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
