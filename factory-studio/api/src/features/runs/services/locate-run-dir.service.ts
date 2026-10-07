import path from 'node:path';
import type { ZodSafeParseResult } from 'zod';
import type { FileInfo, FsClient, JsonRead } from '../../../clients/fs/fs.types.js';
import { runStateFileSchema } from '../runs.schema.js';
import type { RunStateFile } from '../runs.types.js';
import { RUN_DIR, STATE_FILE, isRunSegment, statePipelineId } from '../runs.utils.js';

export interface LocateRunDirSettings {
  fs: FsClient;
  workDir: string;
}

const isDirectory = async (fs: FsClient, dir: string): Promise<boolean> => {
  const info: FileInfo | null = await fs.stat(dir);
  return info !== null && info.isDirectory;
};

/** Does `<candidate>/state.json` declare `pipelineId`? */
const declares = async (fs: FsClient, candidate: string, pipelineId: string): Promise<boolean> => {
  const read: JsonRead = await fs.readJson(path.join(candidate, STATE_FILE));
  if (!read.ok) return false;
  const parsed: ZodSafeParseResult<RunStateFile> = runStateFileSchema.safeParse(read.value);
  return parsed.success && statePipelineId(parsed.data) === pipelineId;
};

/**
 * The folder of a run: `run/<pipelineId>/<runId>` first; failing that, the one folder under
 * `run/` holding `<runId>` whose state file declares `pipelineId` (a run filed under an old
 * folder name still has to resolve). `null` when there is no such run.
 */
export const locateRunDirFactory =
  ({ fs, workDir }: LocateRunDirSettings) =>
  async (pipelineId: string, runId: string): Promise<string | null> => {
    if (!isRunSegment(pipelineId) || !isRunSegment(runId)) return null;
    const runRoot: string = path.join(workDir, RUN_DIR);
    const direct: string = path.join(runRoot, pipelineId, runId);
    if (await isDirectory(fs, direct)) return direct;

    const folders: string[] = await fs.subdirectories(runRoot);
    const matches: (string | null)[] = await Promise.all(
      folders.map(async (folder: string): Promise<string | null> => {
        const candidate: string = path.join(runRoot, folder, runId);
        if (!(await isDirectory(fs, candidate))) return null;
        return (await declares(fs, candidate, pipelineId)) ? candidate : null;
      }),
    );
    return (
      matches.find((candidate: string | null): candidate is string => candidate !== null) ?? null
    );
  };
