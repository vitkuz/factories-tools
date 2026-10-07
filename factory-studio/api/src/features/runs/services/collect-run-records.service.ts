import path from 'node:path';
import type { ZodSafeParseResult } from 'zod';
import type { FsClient, JsonRead } from '../../../clients/fs/fs.types.js';
import type { AppLogger } from '../../../shared/types.js';
import { discoveredPipelineSchema } from '../../pipelines/pipelines.schema.js';
import type { DiscoveredPipeline } from '../../pipelines/pipelines.types.js';
import { costFileSchema, runStateFileSchema } from '../runs.schema.js';
import type { CostFile, RunRecord, RunStateFile } from '../runs.types.js';
import {
  COST_FILE,
  PIPELINE_SNAPSHOT_FILE,
  RUN_DIR,
  STATE_FILE,
  sortRuns,
  statePipelineId,
} from '../runs.utils.js';

export interface CollectRunRecordsSettings {
  fs: FsClient;
  workDir: string;
  logger?: AppLogger;
}

type StateRead = { ok: true; hasState: boolean; state: RunStateFile | null } | { ok: false };

interface CostRead {
  cost: CostFile | null;
  hasCost: boolean;
}

const readState = async (
  fs: FsClient,
  runDir: string,
  label: string,
  logger?: AppLogger,
): Promise<StateRead> => {
  const read: JsonRead = await fs.readJson(path.join(runDir, STATE_FILE));
  if (!read.ok) {
    if (read.reason === 'missing') return { ok: true, hasState: false, state: null };
    logger?.warn('skipping run with unparseable state.json', { run: label, message: read.message });
    return { ok: false };
  }
  const parsed: ZodSafeParseResult<RunStateFile> = runStateFileSchema.safeParse(read.value);
  if (!parsed.success) {
    logger?.warn('skipping run with a state.json of the wrong shape', { run: label });
    return { ok: false };
  }
  return { ok: true, hasState: true, state: parsed.data };
};

/** `cost.json` is written by ai-usage; missing is normal, unreadable is reported as such. */
const readCost = async (
  fs: FsClient,
  runDir: string,
  label: string,
  logger?: AppLogger,
): Promise<CostRead> => {
  const read: JsonRead = await fs.readJson(path.join(runDir, COST_FILE));
  if (!read.ok) {
    if (read.reason === 'missing') return { cost: null, hasCost: false };
    logger?.warn('ignoring unparseable cost.json', { run: label, message: read.message });
    return { cost: null, hasCost: true };
  }
  const parsed: ZodSafeParseResult<CostFile> = costFileSchema.safeParse(read.value);
  if (!parsed.success) {
    logger?.warn('ignoring cost.json that is not an object', { run: label });
    return { cost: null, hasCost: true };
  }
  return { cost: parsed.data, hasCost: true };
};

const readSnapshot = async (
  fs: FsClient,
  runDir: string,
  label: string,
  logger?: AppLogger,
): Promise<DiscoveredPipeline | undefined> => {
  const read: JsonRead = await fs.readJson(path.join(runDir, PIPELINE_SNAPSHOT_FILE));
  if (!read.ok) {
    if (read.reason === 'unparseable') {
      logger?.warn('ignoring unparseable pipeline.json snapshot', {
        run: label,
        message: read.message,
      });
    }
    return undefined;
  }
  const parsed: ZodSafeParseResult<DiscoveredPipeline> = discoveredPipelineSchema.safeParse(
    read.value,
  );
  if (!parsed.success) {
    logger?.warn('ignoring pipeline.json snapshot without id and steps', { run: label });
    return undefined;
  }
  return parsed.data;
};

const toRecord = async (
  settings: CollectRunRecordsSettings,
  folderId: string,
  runId: string,
): Promise<RunRecord | null> => {
  const { fs, workDir, logger }: CollectRunRecordsSettings = settings;
  const runDir: string = path.join(workDir, RUN_DIR, folderId, runId);
  const label: string = `${folderId}/${runId}`;
  const state: StateRead = await readState(fs, runDir, label, logger);
  if (!state.ok) return null;

  // The folder under run/ is normally the pipeline id, but the state file says which
  // pipeline it ran, so it decides and the folder name is only the fallback.
  const declaredId: string | null = statePipelineId(state.state);
  if (declaredId !== null && declaredId !== folderId) {
    logger?.warn('run declares another pipeline than its folder', { run: label, declaredId });
  }
  const cost: CostRead = await readCost(fs, runDir, label, logger);
  const snapshot: DiscoveredPipeline | undefined = await readSnapshot(fs, runDir, label, logger);

  return {
    runId,
    pipelineId: declaredId ?? folderId,
    dir: path.relative(workDir, runDir).split(path.sep).join('/'),
    hasState: state.hasState,
    state: state.state,
    cost: cost.cost,
    hasCost: cost.hasCost,
    ...(snapshot === undefined ? {} : { pipeline: snapshot }),
  };
};

/** Every `run/<pipelineId>/<runId>` folder, read fresh, sorted newest first. */
export const collectRunRecordsFactory =
  (settings: CollectRunRecordsSettings) => async (): Promise<RunRecord[]> => {
    const { fs, workDir }: CollectRunRecordsSettings = settings;
    const runRoot: string = path.join(workDir, RUN_DIR);
    const folders: string[] = await fs.subdirectories(runRoot);
    const perFolder: (RunRecord | null)[][] = await Promise.all(
      folders.map(async (folderId: string): Promise<(RunRecord | null)[]> => {
        const runIds: string[] = await fs.subdirectories(path.join(runRoot, folderId));
        return Promise.all(
          runIds.map((runId: string): Promise<RunRecord | null> =>
            toRecord(settings, folderId, runId),
          ),
        );
      }),
    );
    const records: RunRecord[] = perFolder
      .flat()
      .filter((record: RunRecord | null): record is RunRecord => record !== null);
    return sortRuns(records);
  };
