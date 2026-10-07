import type {
  NewSessionArgs,
  TmuxClient,
  TmuxSessionInfo,
} from '../src/clients/tmux/tmux.types.js';

export interface FakeSession {
  name: string;
  createdAt: Date;
  labels: Record<string, string>;
  command: string;
  cwd: string;
}

export interface FakeTmux {
  client: TmuxClient;
  sessions: FakeSession[];
  killed: string[];
  /** Names that die the moment they are created — a harness not on PATH, say. */
  dieOnStart: Set<string>;
}

/** An in-memory tmux server. Sessions are records; nothing is executed. */
export const fakeTmux = (initial: FakeSession[] = []): FakeTmux => {
  const sessions: FakeSession[] = [...initial];
  const killed: string[] = [];
  const dieOnStart: Set<string> = new Set();

  const client: TmuxClient = {
    newSession: async ({ name, cwd, command, labels = {} }: NewSessionArgs): Promise<void> => {
      if (dieOnStart.has(name)) return;
      sessions.push({ name, cwd, command, labels: { ...labels }, createdAt: new Date() });
    },
    listSessions: async (labelNames: readonly string[]): Promise<TmuxSessionInfo[]> =>
      sessions.map((session: FakeSession): TmuxSessionInfo => ({
        name: session.name,
        createdAt: session.createdAt,
        labels: Object.fromEntries(
          labelNames.map((label: string): [string, string] => [label, session.labels[label] ?? '']),
        ),
      })),
    hasSession: async (name: string): Promise<boolean> =>
      sessions.some((session: FakeSession): boolean => session.name === name),
    killSession: async (name: string): Promise<boolean> => {
      const index: number = sessions.findIndex(
        (session: FakeSession): boolean => session.name === name,
      );
      if (index === -1) return false;
      sessions.splice(index, 1);
      killed.push(name);
      return true;
    },
  };

  return { client, sessions, killed, dieOnStart };
};

export const session = (
  name: string,
  factoryId: string,
  harness: string,
  ageSeconds: number = 60,
): FakeSession => ({
  name,
  createdAt: new Date(Date.now() - ageSeconds * 1000),
  labels: { harness, factory_id: factoryId },
  command: '',
  cwd: '/work',
});
