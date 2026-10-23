import { isSafeSegment } from '../documents/documents.utils.js';
import type { DiscoveredPipeline, PipelineSkill } from '../pipelines/pipelines.types.js';
import type { ZodSafeParseResult } from 'zod';
import { runSessionStampSchema } from './runs.schema.js';
import type {
  RunRecord,
  RunSessionStamp,
  RunStateFile,
  SessionRunLink,
  SessionRunQuery,
} from './runs.types.js';

export const RUN_DIR = 'run';
export const STATE_FILE = 'state.json';
export const COST_FILE = 'cost.json';
export const PIPELINE_SNAPSHOT_FILE = 'pipeline.json';
/** Removed runs: `run/.trash/<folder>/<runId>-<stamp>`. Out of the feed, back by one `mv`. */
export const TRASH_DIR = '.trash';

/**
 * A folder under `run/` that holds runs: never a hidden one, so `.trash` (and any other
 * dot-folder) is not read as a pipeline.
 */
export const isRunFolder = (name: string): boolean => !name.startsWith('.');

/** `2026-10-24T10:15:30.123Z` -> `20261024T101530123Z`: sortable, one path segment. Pure. */
export const trashStamp = (at: Date): string => at.toISOString().replace(/[-:.]/g, '');

/** Where a removed run goes, relative to the run root. Pure. */
export const trashSegments = (folder: string, runId: string, at: Date): string[] => [
  TRASH_DIR,
  folder,
  `${runId}-${trashStamp(at)}`,
];

/** A `:pipelineId` or `:runId` is one folder name, never a path. */
export const isRunSegment = (value: string): boolean => isSafeSegment(value);

/**
 * The pipeline a state file says it ran. `pipelineName` is the current recorder's field,
 * `pipeline` the older one's. No aliases: nothing here was renamed.
 */
export const statePipelineId = (state: RunStateFile | null): string | null => {
  if (state === null) return null;
  if (typeof state.pipelineName === 'string' && state.pipelineName !== '')
    return state.pipelineName;
  if (typeof state.pipeline === 'string' && state.pipeline !== '') return state.pipeline;
  return null;
};

export const runCreatedAt = (record: RunRecord): string =>
  record.state?.createdAt ?? record.state?.startAt ?? '';

/** Newest `createdAt` first, stateful before stateless, then by run id. Returns a new array. */
export const sortRuns = (runs: readonly RunRecord[]): RunRecord[] =>
  [...runs].sort((a: RunRecord, b: RunRecord): number => {
    const at: string = runCreatedAt(a);
    const bt: string = runCreatedAt(b);
    if (at !== '' && bt !== '' && at !== bt) return bt.localeCompare(at);
    if (at !== '' && bt === '') return -1;
    if (at === '' && bt !== '') return 1;
    return a.runId.localeCompare(b.runId);
  });

/** Definitions keyed by the file's `id` field; on a duplicate the first wins and `warn` hears. */
export const pipelinesById = (
  skills: readonly PipelineSkill[],
  warn: (message: string) => void,
): Record<string, DiscoveredPipeline> =>
  skills.reduce(
    (
      acc: Record<string, DiscoveredPipeline>,
      skill: PipelineSkill,
    ): Record<string, DiscoveredPipeline> => {
      const key: string = skill.pipeline.id;
      if (key in acc) {
        warn(`duplicate pipeline id '${key}' in ${skill.path}; keeping the first`);
        return acc;
      }
      return { ...acc, [key]: skill.pipeline };
    },
    {},
  );

/* ---------------------------------------------------------------- run <-> session */

/** A run that is over asks nobody anything. */
const FINISHED_STATUSES: readonly string[] = ['COMPLETED', 'FAILED', 'ABORTED'];

const isFinished = (record: RunRecord): boolean =>
  FINISHED_STATUSES.includes(record.state?.status ?? '');

/**
 * The harness session that opened the run, as the recorder stamped it: the state's own
 * `sessionId`, else the one on its `PIPELINE_INIT` entry. `''` when it has none (an older
 * recorder, or a harness that sets no session id).
 */
export const runSessionId = (state: RunStateFile | null): string => {
  if (state === null) return '';
  const parsed: ZodSafeParseResult<RunSessionStamp> = runSessionStampSchema.safeParse(state);
  if (!parsed.success) return '';
  const own: string = parsed.data.sessionId ?? '';
  if (own !== '') return own;
  const init: RunSessionStamp['history'] = (parsed.data.history ?? []).filter(
    (entry: NonNullable<RunSessionStamp['history']>[number]): boolean =>
      entry.type === 'PIPELINE_INIT',
  );
  return init[0]?.details?.sessionId ?? '';
};

const toLink =
  (match: SessionRunLink['match']) =>
  (record: RunRecord): SessionRunLink => ({
    pipelineId: record.pipelineId,
    runId: record.runId,
    match,
  });

const createdAtMs = (record: RunRecord): number => Date.parse(runCreatedAt(record));

/**
 * The run a session's question belongs to, or `null`.
 *
 * 1. `session` — the run the recorder stamped with the asking Claude session id. Exact: the
 *    stamp is written by the `open` that created the run, in the session that asks. Of several
 *    (one session that ran the factory twice) the newest wins.
 * 2. `started-after` — only for a run with no stamp at all (an older recorder): the first
 *    unfinished run of the session's factory created at or after the session started.
 *
 * A run stamped with another session is never taken by the fallback.
 */
export const findSessionRun = (
  runs: readonly RunRecord[],
  query: SessionRunQuery,
): SessionRunLink | null => {
  const claudeSessionId: string = query.claudeSessionId ?? '';
  const stamped: RunRecord[] =
    claudeSessionId === ''
      ? []
      : sortRuns(
          runs.filter(
            (record: RunRecord): boolean => runSessionId(record.state) === claudeSessionId,
          ),
        );
  const exact: RunRecord | undefined = stamped[0];
  if (exact !== undefined) return toLink('session')(exact);

  const startedAt: number = Date.parse(query.startedAt ?? '');
  if (query.factoryId === undefined || Number.isNaN(startedAt)) return null;
  const candidates: RunRecord[] = runs
    .filter(
      (record: RunRecord): boolean =>
        record.pipelineId === query.factoryId &&
        runSessionId(record.state) === '' &&
        !isFinished(record) &&
        createdAtMs(record) >= startedAt,
    )
    .sort((a: RunRecord, b: RunRecord): number => createdAtMs(a) - createdAtMs(b));
  const first: RunRecord | undefined = candidates[0];
  return first === undefined ? null : toLink('started-after')(first);
};
