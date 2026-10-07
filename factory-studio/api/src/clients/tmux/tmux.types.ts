import type { AppLogger } from '../../shared/types.js';

export interface TmuxClientSettings {
  /** Full path to the tmux binary. */
  bin: string;
  logger?: AppLogger;
}

export interface NewSessionArgs {
  /** Session name. Must not contain `.` or `:`, which tmux reserves for targets. */
  name: string;
  /** Directory the session's shell starts in. */
  cwd: string;
  /** Shell command run in the session's first window. The session ends when it exits. */
  command: string;
  /**
   * Labels stored on the session as tmux user options, readable back from `listSessions`.
   * They live with the session, so they survive a restart of whoever set them.
   */
  labels?: Readonly<Record<string, string>>;
}

export interface TmuxSessionInfo {
  name: string;
  createdAt: Date;
  /** The labels asked for, by name. Absent on the session means an empty string here. */
  labels: Readonly<Record<string, string>>;
}

export interface TmuxClient {
  newSession: (args: NewSessionArgs) => Promise<void>;
  /** Every session on the server, with the named labels read back. No server means none. */
  listSessions: (labelNames: readonly string[]) => Promise<TmuxSessionInfo[]>;
  hasSession: (name: string) => Promise<boolean>;
  /** `false` when there was no such session to kill. */
  killSession: (name: string) => Promise<boolean>;
}
