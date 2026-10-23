import type {
  CreateWorkspaceArgs,
  CreatedWorkspace,
  HerdrAgentStatus,
  HerdrClient,
  HerdrPane,
  HerdrWorkspace,
} from '../src/clients/herdr/herdr.types.js';

export interface FakeWorkspace {
  workspaceId: string;
  label: string;
  paneId: string;
  cwd: string;
  env: Record<string, string>;
  /** What `runInPane` typed into the pane. */
  commands: string[];
  /** Plain text sent with `sendText`, and the key lists sent with `sendKeys`. */
  texts: string[];
  keys: string[][];
  status: HerdrAgentStatus;
}

export interface FakeHerdr {
  client: HerdrClient;
  workspaces: FakeWorkspace[];
  closed: string[];
  /** Labels whose workspace is gone the moment its command runs — a harness not on PATH. */
  dieOnRun: Set<string>;
}

/** An in-memory herdr server. Workspaces are records; nothing is executed. */
export const fakeHerdr = (initial: FakeWorkspace[] = []): FakeHerdr => {
  const workspaces: FakeWorkspace[] = [...initial];
  const closed: string[] = [];
  const dieOnRun: Set<string> = new Set();
  const remove = (workspaceId: string): void => {
    const index: number = workspaces.findIndex(
      (workspace: FakeWorkspace): boolean => workspace.workspaceId === workspaceId,
    );
    if (index !== -1) workspaces.splice(index, 1);
  };
  const byPane = (paneId: string): FakeWorkspace | undefined =>
    workspaces.find((workspace: FakeWorkspace): boolean => workspace.paneId === paneId);

  const client: HerdrClient = {
    ensureServer: async (): Promise<void> => {},
    createWorkspace: async ({
      cwd,
      label,
      env,
    }: CreateWorkspaceArgs): Promise<CreatedWorkspace> => {
      const n: number = workspaces.length + closed.length + 1;
      const created: FakeWorkspace = {
        workspaceId: `w${n}`,
        paneId: `w${n}:p1`,
        label,
        cwd,
        env: { ...env },
        commands: [],
        texts: [],
        keys: [],
        status: 'unknown',
      };
      workspaces.push(created);
      return { workspaceId: created.workspaceId, paneId: created.paneId };
    },
    runInPane: async (paneId: string, command: string): Promise<void> => {
      const target: FakeWorkspace | undefined = byPane(paneId);
      if (!target) return;
      target.commands.push(command);
      if (dieOnRun.has(target.label)) remove(target.workspaceId);
    },
    sendText: async (paneId: string, text: string): Promise<void> => {
      byPane(paneId)?.texts.push(text);
    },
    sendKeys: async (paneId: string, keys: readonly string[]): Promise<void> => {
      byPane(paneId)?.keys.push([...keys]);
    },
    listWorkspaces: async (): Promise<HerdrWorkspace[]> =>
      workspaces.map((workspace: FakeWorkspace): HerdrWorkspace => ({
        workspaceId: workspace.workspaceId,
        label: workspace.label,
        status: workspace.status,
      })),
    listPanes: async (): Promise<HerdrPane[]> =>
      workspaces.map((workspace: FakeWorkspace): HerdrPane => ({
        paneId: workspace.paneId,
        workspaceId: workspace.workspaceId,
        cwd: workspace.cwd,
        status: workspace.status,
      })),
    closeWorkspace: async (workspaceId: string): Promise<boolean> => {
      if (
        !workspaces.some(
          (workspace: FakeWorkspace): boolean => workspace.workspaceId === workspaceId,
        )
      ) {
        return false;
      }
      remove(workspaceId);
      closed.push(workspaceId);
      return true;
    },
    readPane: async (): Promise<string> => '',
  };

  return { client, workspaces, closed, dieOnRun };
};

/** A workspace that is already running, as `fakeHerdr([...])` takes it. */
export const workspace = (
  workspaceId: string,
  label: string,
  status: HerdrAgentStatus = 'idle',
): FakeWorkspace => ({
  workspaceId,
  label,
  paneId: `${workspaceId}:p1`,
  cwd: '/work',
  env: {},
  commands: [],
  texts: [],
  keys: [],
  status,
});
