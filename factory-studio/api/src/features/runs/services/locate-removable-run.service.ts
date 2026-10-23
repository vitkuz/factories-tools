import path from 'node:path';
import type { FsClient, LinkInfo } from '../../../clients/fs/fs.types.js';
import type { LocateRemovableRunResult, RunServices } from '../runs.types.js';
import { RUN_DIR, isRunFolder } from '../runs.utils.js';

export interface LocateRemovableRunSettings extends Pick<RunServices, 'locateRunDir'> {
  fs: FsClient;
  workDir: string;
}

const refused = (message: string): LocateRemovableRunResult => ({
  ok: false,
  reason: 'refused',
  message,
});

/**
 * The run folder a remove may move, found the way every run route finds it, then held to
 * more: it is two levels under `run/` in a folder that is not hidden, neither it nor its
 * folder is a symlink, and its real path is exactly `<real run root>/<folder>/<runId>`.
 */
export const locateRemovableRunFactory =
  ({ fs, workDir, locateRunDir }: LocateRemovableRunSettings) =>
  async (pipelineId: string, runId: string): Promise<LocateRemovableRunResult> => {
    const dir: string | null = await locateRunDir(pipelineId, runId);
    if (dir === null) return { ok: false, reason: 'not-found' };

    const runRoot: string = path.join(workDir, RUN_DIR);
    const folderDir: string = path.dirname(dir);
    const folder: string = path.basename(folderDir);
    if (path.dirname(folderDir) !== runRoot || path.basename(dir) !== runId || !isRunFolder(folder))
      return refused('the run is not a folder of run/<pipelineId>/');

    const [own, parent]: [LinkInfo | null, LinkInfo | null] = await Promise.all([
      fs.lstat(dir),
      fs.lstat(folderDir),
    ]);
    if (own === null) return { ok: false, reason: 'not-found' };
    if (own.isSymbolicLink || parent?.isSymbolicLink === true)
      return refused('the run folder is a symlink; it is not moved');
    if (!own.isDirectory) return refused('the run is not a folder');

    const [realRoot, realDir]: [string | null, string | null] = await Promise.all([
      fs.realpath(runRoot),
      fs.realpath(dir),
    ]);
    if (realRoot === null || realDir === null) return { ok: false, reason: 'not-found' };
    if (realDir !== path.join(realRoot, folder, runId))
      return refused('the run folder resolves outside run/<pipelineId>/');
    return { ok: true, run: { dir, folder } };
  };
