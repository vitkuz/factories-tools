import path from 'node:path';
import type { FsClient } from '../../../clients/fs/fs.types.js';
import type { AppLogger } from '../../../shared/types.js';
import type { RemovableRunDir } from '../runs.types.js';
import { RUN_DIR, trashSegments } from '../runs.utils.js';

export interface MoveRunToTrashSettings {
  fs: FsClient;
  workDir: string;
  logger?: AppLogger;
  now?: () => Date;
}

/**
 * Remove is a move, never a delete: the folder goes whole to
 * `run/.trash/<folder>/<runId>-<stamp>`, so a slip is undone with one `mv`.
 */
export const moveRunToTrashFactory =
  ({ fs, workDir, logger, now = (): Date => new Date() }: MoveRunToTrashSettings) =>
  async (run: RemovableRunDir, runId: string): Promise<string> => {
    const target: string = path.join(workDir, RUN_DIR, ...trashSegments(run.folder, runId, now()));
    await fs.move(run.dir, target);
    logger?.info('run moved to trash', { from: run.dir, to: target });
    return target;
  };
