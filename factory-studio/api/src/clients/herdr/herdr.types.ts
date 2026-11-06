import type { AppLogger } from '../../shared/types.js';

export interface HerdrClientSettings {
  /** Full path to the herdr binary. */
  bin: string;
  /** The named herdr session (its own headless server). Never the user's own sessions. */
  session: string;
  logger?: AppLogger;
  /** How long `ensureServer` waits for a freshly spawned server to answer. */
  serverStartTimeoutMs?: number;
}

/** herdr's per-agent lifecycle, as `agent_status` reports it. */
export type HerdrAgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';

export interface HerdrWorkspace {
  workspaceId: string;
  label: string;
  status: HerdrAgentStatus;
}

export interface HerdrPane {
  paneId: string;
  workspaceId: string;
  cwd: string;
  status: HerdrAgentStatus;
  /** The agent's own session id when herdr's integration reported one (Claude's session uuid). */
  agentSessionId?: string;
}

export interface CreateWorkspaceArgs {
  cwd: string;
  label: string;
  /** Reaches every process started in the workspace's panes, hooks included. */
  env: Readonly<Record<string, string>>;
}

export interface CreatedWorkspace {
  workspaceId: string;
  paneId: string;
}

/**
 * What `agent prompt --wait --until working` came back with. `submitted` is herdr's word that
 * the text and Enter were written; `started` that it then saw the agent working. A refusal
 * (`agent_blocked`, `agent_not_found`…) carries herdr's own code.
 */
export type PromptAgentResult =
  | { ok: true; started: boolean; status: HerdrAgentStatus }
  | { ok: false; code: string; message: string };

export interface HerdrClient {
  /** Starts the headless server of this session when none answers. Idempotent. */
  ensureServer: () => Promise<void>;
  createWorkspace: (args: CreateWorkspaceArgs) => Promise<CreatedWorkspace>;
  /** Types the command into the pane's shell and presses Enter. */
  runInPane: (paneId: string, command: string) => Promise<void>;
  /** Literal text, no Enter. */
  sendText: (paneId: string, text: string) => Promise<void>;
  /**
   * `text` and Enter as one submission to the agent in the pane (bracketed paste when the
   * agent has it on, so a multi-line text arrives whole), then waits up to `waitMs` for the
   * agent to be seen working. Refused by herdr while the agent sits in a dialog.
   */
  promptAgent: (paneId: string, text: string, waitMs: number) => Promise<PromptAgentResult>;
  sendKeys: (paneId: string, keys: readonly string[]) => Promise<void>;
  /** No server means none. */
  listWorkspaces: () => Promise<HerdrWorkspace[]>;
  listPanes: () => Promise<HerdrPane[]>;
  /** `false` when there was no such workspace. Closing kills everything inside. */
  closeWorkspace: (workspaceId: string) => Promise<boolean>;
  /** The last `lines` lines of the pane as plain text. */
  readPane: (paneId: string, lines: number) => Promise<string>;
}
