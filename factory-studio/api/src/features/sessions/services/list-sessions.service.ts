import type { HerdrClient, HerdrPane, HerdrWorkspace } from '../../../clients/herdr/herdr.types.js';
import type { FactorySession, SessionMeta } from '../sessions.types.js';
import { isFactorySession, toFactorySession } from '../sessions.utils.js';

export interface ListSessionsSettings {
  herdr: HerdrClient;
  /** `null` when the session has no readable meta file. */
  readMeta: (session: string) => Promise<SessionMeta | null>;
  now?: () => Date;
}

/** Every `factory-*` workspace on the herdr server, oldest first. Other workspaces are not ours. */
export const listSessionsFactory =
  ({ herdr, readMeta, now = (): Date => new Date() }: ListSessionsSettings) =>
  async (): Promise<FactorySession[]> => {
    const [workspaces, panes]: [HerdrWorkspace[], HerdrPane[]] = await Promise.all([
      herdr.listWorkspaces(),
      herdr.listPanes(),
    ]);
    const at: Date = now();
    const ours: HerdrWorkspace[] = workspaces.filter((workspace: HerdrWorkspace): boolean =>
      isFactorySession(workspace.label),
    );
    const sessions: FactorySession[] = await Promise.all(
      ours.map(async (workspace: HerdrWorkspace): Promise<FactorySession> => {
        const pane: HerdrPane | undefined = panes.find(
          (candidate: HerdrPane): boolean => candidate.workspaceId === workspace.workspaceId,
        );
        return toFactorySession(workspace, pane, await readMeta(workspace.label), at);
      }),
    );
    return sessions.sort(
      (a: FactorySession, b: FactorySession): number => b.ageSeconds - a.ageSeconds,
    );
  };
