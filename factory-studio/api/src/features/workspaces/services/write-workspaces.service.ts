import type { FsClient } from '../../../clients/fs/fs.types.js';
import type { AppLogger } from '../../../shared/types.js';
import type { WorkspacesFile } from '../workspaces.types.js';
import { formatWorkspacesFile, workspacesFilePath } from '../workspaces.utils.js';

export interface WriteWorkspacesSettings {
  fs: FsClient;
  workDir: string;
  logger?: AppLogger;
}

/** Writes the whole `run/workspaces.json`, pretty, through a temp file and a rename. */
export const writeWorkspacesFactory =
  ({ fs, workDir, logger }: WriteWorkspacesSettings) =>
  async (file: WorkspacesFile): Promise<number> => {
    const target: string = workspacesFilePath(workDir);
    const bytes: number = await fs.writeTextAtomic(target, formatWorkspacesFile(file));
    logger?.info('workspaces file written', { file: target, count: file.workspaces.length });
    return bytes;
  };
