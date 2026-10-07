import { isSafeSegment } from '../documents/documents.utils.js';
import type { DiscoveredPipeline, PipelineSkill } from '../pipelines/pipelines.types.js';
import type { RunRecord, RunStateFile } from './runs.types.js';

export const RUN_DIR = 'run';
export const STATE_FILE = 'state.json';
export const COST_FILE = 'cost.json';
export const PIPELINE_SNAPSHOT_FILE = 'pipeline.json';

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
