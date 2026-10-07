import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  NewSessionArgs,
  TmuxClient,
  TmuxClientSettings,
  TmuxSessionInfo,
} from './tmux.types.js';

const execFileAsync = promisify(execFile);

interface TmuxResult {
  stdout: string;
  stderr: string;
}

/** What tmux says when there is no server to talk to. Not an error for a read. */
const NO_SERVER: RegExp = /no server running|error connecting to/i;
const NO_SESSION: RegExp = /can't find session|session not found|no such session/i;

const errorText = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'stderr' in error
    ? String((error as { stderr: unknown }).stderr)
    : error instanceof Error
      ? error.message
      : String(error);

/**
 * The only place that shells out. Arguments go to tmux as an argv array — no shell sits
 * between this process and the binary, so nothing here needs quoting.
 */
const runFactory =
  (settings: TmuxClientSettings) =>
  async (args: readonly string[]): Promise<TmuxResult> => {
    settings.logger?.debug('tmux', { args });
    const result: TmuxResult = await execFileAsync(settings.bin, [...args], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    return result;
  };

/**
 * `-t =name` is the exact form for has-session and kill-session. A bare `-t name` is a prefix
 * match in tmux, and `factory-canonical` would happily resolve to `factory-canonical-7f3a9c2b`.
 */
const exactTarget = (name: string): string => `=${name}`;

/** User options must start with `@`; the label names callers use do not. */
const optionName = (label: string): string => `@${label}`;

const newSessionFactory =
  (settings: TmuxClientSettings) =>
  async ({ name, cwd, command, labels = {} }: NewSessionArgs): Promise<void> => {
    const run = runFactory(settings);
    // `-P -F` prints the new session's id (`$12`). Options are set against that id: it is exact
    // by construction, whereas `set-option -t name` is a prefix match and `-t =name` is not
    // accepted there at all (tmux 3.4).
    const { stdout }: TmuxResult = await run([
      'new-session',
      '-d',
      '-s',
      name,
      '-c',
      cwd,
      '-P',
      '-F',
      '#{session_id}',
      command,
    ]);
    const sessionId: string = stdout.trim();
    for (const [label, value] of Object.entries(labels)) {
      try {
        await run(['set-option', '-t', sessionId, optionName(label), value]);
      } catch (error: unknown) {
        // The command already exited and took the session with it. Not this call's problem:
        // the caller checks whether the session is alive and reports that.
        if (NO_SESSION.test(errorText(error))) break;
        throw error;
      }
    }
    settings.logger?.info('tmux session started', { name, cwd, labels });
  };

const parseSessionLine =
  (labelNames: readonly string[]) =>
  (line: string): TmuxSessionInfo | null => {
    const [name, created, ...labelValues]: string[] = line.split('\t');
    if (!name) return null;
    const createdEpoch: number = Number(created);
    const labels: Record<string, string> = Object.fromEntries(
      labelNames.map((label: string, index: number): [string, string] => [
        label,
        labelValues[index] ?? '',
      ]),
    );
    return {
      name,
      createdAt: new Date(Number.isFinite(createdEpoch) ? createdEpoch * 1000 : 0),
      labels,
    };
  };

const listSessionsFactory =
  (settings: TmuxClientSettings) =>
  async (labelNames: readonly string[]): Promise<TmuxSessionInfo[]> => {
    const fields: string[] = [
      '#{session_name}',
      '#{session_created}',
      ...labelNames.map((label: string): string => `#{${optionName(label)}}`),
    ];
    try {
      const { stdout }: TmuxResult = await runFactory(settings)([
        'list-sessions',
        '-F',
        fields.join('\t'),
      ]);
      return stdout
        .split('\n')
        .map(parseSessionLine(labelNames))
        .filter((info: TmuxSessionInfo | null): info is TmuxSessionInfo => info !== null);
    } catch (error: unknown) {
      if (NO_SERVER.test(errorText(error))) return [];
      throw error;
    }
  };

const hasSessionFactory =
  (settings: TmuxClientSettings) =>
  async (name: string): Promise<boolean> => {
    try {
      await runFactory(settings)(['has-session', '-t', exactTarget(name)]);
      return true;
    } catch (error: unknown) {
      const text: string = errorText(error);
      if (NO_SERVER.test(text) || NO_SESSION.test(text)) return false;
      throw error;
    }
  };

const killSessionFactory =
  (settings: TmuxClientSettings) =>
  async (name: string): Promise<boolean> => {
    try {
      await runFactory(settings)(['kill-session', '-t', exactTarget(name)]);
      settings.logger?.info('tmux session killed', { name });
      return true;
    } catch (error: unknown) {
      const text: string = errorText(error);
      if (NO_SERVER.test(text) || NO_SESSION.test(text)) return false;
      throw error;
    }
  };

export const createTmuxClient = (settings: TmuxClientSettings): TmuxClient => ({
  newSession: newSessionFactory(settings),
  listSessions: listSessionsFactory(settings),
  hasSession: hasSessionFactory(settings),
  killSession: killSessionFactory(settings),
});
