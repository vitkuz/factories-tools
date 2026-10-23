import type { HerdrAgentStatus, HerdrPane, HerdrWorkspace } from './herdr.types.js';

const STATUSES: readonly HerdrAgentStatus[] = ['idle', 'working', 'blocked', 'done', 'unknown'];

export const toStatus = (value: unknown): HerdrAgentStatus =>
  STATUSES.find((status: HerdrAgentStatus): boolean => status === value) ?? 'unknown';

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** The `result` of one herdr JSON reply, `{}` when the text is not a reply. */
export const parseResult = (text: string): Record<string, unknown> => {
  try {
    return asRecord(asRecord(JSON.parse(text)).result);
  } catch {
    return {};
  }
};

/** `{"error":{"code","message"}}` from stdout or stderr; `null` when there is none. */
export const parseError = (text: string): { code: string; message: string } | null => {
  try {
    const error: Record<string, unknown> = asRecord(asRecord(JSON.parse(text)).error);
    return typeof error.code === 'string'
      ? { code: error.code, message: asString(error.message) }
      : null;
  } catch {
    return null;
  }
};

export const toWorkspaces = (result: Record<string, unknown>): HerdrWorkspace[] =>
  asArray(result.workspaces).map((raw: unknown): HerdrWorkspace => {
    const item: Record<string, unknown> = asRecord(raw);
    return {
      workspaceId: asString(item.workspace_id),
      label: asString(item.label),
      status: toStatus(item.agent_status),
    };
  });

export const toPanes = (result: Record<string, unknown>): HerdrPane[] =>
  asArray(result.panes).map((raw: unknown): HerdrPane => {
    const item: Record<string, unknown> = asRecord(raw);
    const agentSessionId: string = asString(asRecord(item.agent_session).value);
    return {
      paneId: asString(item.pane_id),
      workspaceId: asString(item.workspace_id),
      cwd: asString(item.cwd),
      status: toStatus(item.agent_status),
      ...(agentSessionId === '' ? {} : { agentSessionId }),
    };
  });

export const toCreatedWorkspace = (
  result: Record<string, unknown>,
): { workspaceId: string; paneId: string } => ({
  workspaceId: asString(asRecord(result.workspace).workspace_id),
  paneId: asString(asRecord(result.root_pane).pane_id),
});

/**
 * The environment herdr is run with: the API's own, minus every `HERDR_*` variable. Left in,
 * they point the CLI at whichever herdr the API happens to be launched from — the user's
 * default session — instead of the named one.
 */
export const cleanEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(env).filter(
      ([key]: [string, string | undefined]): boolean => !key.startsWith('HERDR_'),
    ),
  );

export const envFlags = (env: Readonly<Record<string, string>>): string[] =>
  Object.entries(env).flatMap(([key, value]: [string, string]): string[] => [
    '--env',
    `${key}=${value}`,
  ]);
