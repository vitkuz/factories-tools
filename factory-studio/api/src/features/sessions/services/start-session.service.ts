import { setTimeout as sleep } from 'node:timers/promises';
import type { HerdrClient, HerdrWorkspace } from '../../../clients/herdr/herdr.types.js';
import type { AppLogger } from '../../../shared/types.js';
import type { StartSessionArgs } from '../sessions.types.js';

export interface StartSessionSettings {
  herdr: HerdrClient;
  /** How long the session must survive before it counts as started. */
  graceMs: number;
  logger?: AppLogger;
}

/**
 * Opens a workspace named after the session and `exec`s the harness in its shell, so the
 * workspace closes by itself when the harness exits. Then waits a moment to see whether it
 * stayed up: a harness that is not on PATH, or one that rejects its flags, exits in well under
 * a second — and without this check a start would report a session that was already gone.
 *
 * `true` when the workspace is still there after the grace period.
 */
export const startSessionFactory =
  ({ herdr, graceMs, logger }: StartSessionSettings) =>
  async ({ session, command, workDir, env }: StartSessionArgs): Promise<boolean> => {
    await herdr.ensureServer();
    const { workspaceId, paneId } = await herdr.createWorkspace({
      cwd: workDir,
      label: session,
      env,
    });
    await herdr.runInPane(paneId, `exec ${command}`);
    if (graceMs > 0) await sleep(graceMs);
    const workspaces: HerdrWorkspace[] = await herdr.listWorkspaces();
    const alive: boolean = workspaces.some(
      (workspace: HerdrWorkspace): boolean => workspace.workspaceId === workspaceId,
    );
    if (!alive) logger?.warn('session exited inside the grace period', { session });
    return alive;
  };
