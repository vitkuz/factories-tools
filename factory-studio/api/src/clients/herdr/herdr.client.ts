import { execFile, spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import type {
  CreateWorkspaceArgs,
  CreatedWorkspace,
  HerdrClient,
  HerdrClientSettings,
  HerdrPane,
  HerdrWorkspace,
} from './herdr.types.js';
import {
  cleanEnv,
  envFlags,
  parseError,
  parseResult,
  toCreatedWorkspace,
  toPanes,
  toWorkspaces,
} from './herdr.utils.js';

const execFileAsync = promisify(execFile);

const SERVER_NOT_RUNNING = 'server_not_running';
const NOT_FOUND: RegExp = /not_found|no such|not found/i;

interface HerdrFailure {
  code: string;
  message: string;
}

/** A failed herdr call, flattened: the code herdr gave, or `exec` when it never answered. */
const failureOf = (error: unknown): HerdrFailure => {
  const streams: string[] =
    typeof error === 'object' && error !== null
      ? [(error as { stdout?: unknown }).stdout, (error as { stderr?: unknown }).stderr].map(
          (value: unknown): string => (typeof value === 'string' ? value : ''),
        )
      : [];
  for (const text of streams) {
    const parsed: HerdrFailure | null = parseError(text);
    if (parsed) return parsed;
  }
  return { code: 'exec', message: error instanceof Error ? error.message : String(error) };
};

/** The one place that shells out. argv only: no shell sits between this process and herdr. */
const execFactory =
  (settings: HerdrClientSettings) =>
  async (args: readonly string[]): Promise<string> => {
    const full: string[] = ['--session', settings.session, ...args];
    settings.logger?.debug('herdr', { args: full });
    const { stdout }: { stdout: string } = await execFileAsync(settings.bin, full, {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      env: cleanEnv(process.env),
    });
    return stdout;
  };

const spawnServer = (settings: HerdrClientSettings): void => {
  const child = spawn(settings.bin, ['--session', settings.session, 'server'], {
    detached: true,
    stdio: 'ignore',
    env: cleanEnv(process.env),
  });
  child.on('error', (error: Error): void => {
    settings.logger?.error('herdr server failed to spawn', { message: error.message });
  });
  child.unref();
  settings.logger?.info('herdr server spawned', { session: settings.session });
};

const isUp = async (exec: (args: readonly string[]) => Promise<string>): Promise<boolean> => {
  try {
    await exec(['workspace', 'list']);
    return true;
  } catch {
    return false;
  }
};

const ensureServerFactory = (settings: HerdrClientSettings) => async (): Promise<void> => {
  const exec = execFactory(settings);
  if (await isUp(exec)) return;
  spawnServer(settings);
  const deadline: number = Date.now() + (settings.serverStartTimeoutMs ?? 8000);
  while (Date.now() < deadline) {
    await sleep(150);
    if (await isUp(exec)) return;
  }
  throw new Error(`herdr server for session "${settings.session}" did not come up`);
};

/**
 * Every call goes through here: a dead server is started once and the call retried, so the
 * API survives the herdr server being stopped under it.
 */
const callFactory = (settings: HerdrClientSettings) => {
  const exec = execFactory(settings);
  const ensure = ensureServerFactory(settings);
  return async (args: readonly string[]): Promise<string> => {
    try {
      return await exec(args);
    } catch (error: unknown) {
      if (failureOf(error).code !== SERVER_NOT_RUNNING) throw error;
      await ensure();
      return exec(args);
    }
  };
};

const createWorkspaceFactory =
  (settings: HerdrClientSettings) =>
  async ({ cwd, label, env }: CreateWorkspaceArgs): Promise<CreatedWorkspace> => {
    const stdout: string = await callFactory(settings)([
      'workspace',
      'create',
      '--cwd',
      cwd,
      '--label',
      label,
      ...envFlags(env),
      '--no-focus',
    ]);
    const created: CreatedWorkspace = toCreatedWorkspace(parseResult(stdout));
    if (created.workspaceId === '' || created.paneId === '') {
      throw new Error('herdr workspace create returned no workspace or pane id');
    }
    settings.logger?.info('herdr workspace created', { label, ...created });
    return created;
  };

const runInPaneFactory =
  (settings: HerdrClientSettings) =>
  async (paneId: string, command: string): Promise<void> => {
    await callFactory(settings)(['pane', 'run', paneId, command]);
  };

const sendTextFactory =
  (settings: HerdrClientSettings) =>
  async (paneId: string, text: string): Promise<void> => {
    await callFactory(settings)(['pane', 'send-text', paneId, text]);
  };

const sendKeysFactory =
  (settings: HerdrClientSettings) =>
  async (paneId: string, keys: readonly string[]): Promise<void> => {
    await callFactory(settings)(['pane', 'send-keys', paneId, ...keys]);
  };

/** Listing never starts a server: no server is an empty list, not a reason to spawn one. */
const listFactory =
  <T>(
    settings: HerdrClientSettings,
    args: readonly string[],
    parse: (r: Record<string, unknown>) => T[],
  ) =>
  async (): Promise<T[]> => {
    try {
      return parse(parseResult(await execFactory(settings)(args)));
    } catch (error: unknown) {
      if (failureOf(error).code === SERVER_NOT_RUNNING) return [];
      throw error;
    }
  };

const closeWorkspaceFactory =
  (settings: HerdrClientSettings) =>
  async (workspaceId: string): Promise<boolean> => {
    try {
      await callFactory(settings)(['workspace', 'close', workspaceId]);
      settings.logger?.info('herdr workspace closed', { workspaceId });
      return true;
    } catch (error: unknown) {
      const failure: HerdrFailure = failureOf(error);
      if (
        failure.code === SERVER_NOT_RUNNING ||
        NOT_FOUND.test(`${failure.code} ${failure.message}`)
      ) {
        return false;
      }
      throw error;
    }
  };

const readPaneFactory =
  (settings: HerdrClientSettings) =>
  (paneId: string, lines: number): Promise<string> =>
    callFactory(settings)(['pane', 'read', paneId, '--lines', String(lines)]);

export const createHerdrClient = (settings: HerdrClientSettings): HerdrClient => ({
  ensureServer: ensureServerFactory(settings),
  createWorkspace: createWorkspaceFactory(settings),
  runInPane: runInPaneFactory(settings),
  sendText: sendTextFactory(settings),
  sendKeys: sendKeysFactory(settings),
  listWorkspaces: listFactory<HerdrWorkspace>(settings, ['workspace', 'list'], toWorkspaces),
  listPanes: listFactory<HerdrPane>(settings, ['pane', 'list'], toPanes),
  closeWorkspace: closeWorkspaceFactory(settings),
  readPane: readPaneFactory(settings),
});
