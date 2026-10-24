import type { ZodSafeParseResult } from 'zod';
import type { FsClient, JsonRead } from '../../../clients/fs/fs.types.js';
import type { AppLogger } from '../../../shared/types.js';
import { workspacesFileSchema } from '../workspaces.schema.js';
import type { WorkspacesFile, WorkspacesRead } from '../workspaces.types.js';
import { WORKSPACES_FILE_LABEL, workspacesFilePath } from '../workspaces.utils.js';

export interface ReadWorkspacesSettings {
  fs: FsClient;
  workDir: string;
  logger?: AppLogger;
}

/**
 * Reads `run/workspaces.json`. No file is no workspaces. A file that is not JSON or does not
 * match the schema is a `problem` with the first reason, logged once per read, never thrown.
 */
export const readWorkspacesFactory =
  ({ fs, workDir, logger }: ReadWorkspacesSettings) =>
  async (): Promise<WorkspacesRead> => {
    const read: JsonRead = await fs.readJson(workspacesFilePath(workDir));
    if (!read.ok && read.reason === 'missing') return { ok: true, exists: false, workspaces: [] };
    if (!read.ok) {
      const problem = `${WORKSPACES_FILE_LABEL} is not valid JSON: ${read.message}`;
      logger?.warn('workspaces file is unreadable', { problem });
      return { ok: false, problem };
    }
    const parsed: ZodSafeParseResult<WorkspacesFile> = workspacesFileSchema.safeParse(read.value);
    if (!parsed.success) {
      const issue: { path: PropertyKey[]; message: string } | undefined = parsed.error.issues[0];
      const where: string = issue === undefined ? '' : issue.path.map(String).join('.');
      const problem = `${WORKSPACES_FILE_LABEL} does not match the workspaces schema: ${
        where === '' ? '' : `${where}: `
      }${issue?.message ?? 'unknown issue'}`;
      logger?.warn('workspaces file is invalid', { problem });
      return { ok: false, problem };
    }
    return { ok: true, exists: true, workspaces: parsed.data.workspaces };
  };
