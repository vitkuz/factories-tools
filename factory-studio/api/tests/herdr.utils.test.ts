import { describe, expect, it } from 'vitest';
import {
  cleanEnv,
  envFlags,
  parseError,
  parseResult,
  toCreatedWorkspace,
  toPanes,
  toStatus,
  toWorkspaces,
} from '../src/clients/herdr/herdr.utils.js';

describe('herdr output shapes', () => {
  it('reads a workspace create reply', () => {
    const text = JSON.stringify({
      id: 'cli:workspace:create',
      result: {
        type: 'workspace_created',
        root_pane: { pane_id: 'w1:p1', workspace_id: 'w1' },
        workspace: { workspace_id: 'w1', label: 'x' },
      },
    });
    expect(toCreatedWorkspace(parseResult(text))).toEqual({ workspaceId: 'w1', paneId: 'w1:p1' });
  });

  it('reads workspace and pane lists, unknown statuses become unknown', () => {
    expect(
      toWorkspaces({
        workspaces: [
          { workspace_id: 'w1', label: 'a', agent_status: 'blocked' },
          { workspace_id: 'w2' },
        ],
      }),
    ).toEqual([
      { workspaceId: 'w1', label: 'a', status: 'blocked' },
      { workspaceId: 'w2', label: '', status: 'unknown' },
    ]);
    expect(
      toPanes({
        panes: [{ pane_id: 'w1:p1', workspace_id: 'w1', cwd: '/x', agent_status: 'working' }],
      }),
    ).toEqual([{ paneId: 'w1:p1', workspaceId: 'w1', cwd: '/x', status: 'working' }]);
    expect(toStatus('nonsense')).toBe('unknown');
    expect(parseResult('not json')).toEqual({});
  });

  it('reads an error reply', () => {
    expect(
      parseError('{"id":"x","error":{"code":"server_not_running","message":"no server"}}'),
    ).toEqual({ code: 'server_not_running', message: 'no server' });
    expect(parseError('plain text')).toBeNull();
  });

  it('strips HERDR_* from the environment and builds --env flags', () => {
    expect(cleanEnv({ PATH: '/bin', HERDR_ENV: '1', HERDR_SOCKET_PATH: '/s' })).toEqual({
      PATH: '/bin',
    });
    expect(envFlags({ A: '1', B: 'x=y' })).toEqual(['--env', 'A=1', '--env', 'B=x=y']);
  });
});
