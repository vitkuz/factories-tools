import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import type { ShellAdapter, ShellResult } from './types.js';

const run = (command: string, args: readonly string[], cwd: string): ShellResult => {
  const result: SpawnSyncReturns<string> = spawnSync(command, [...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.error === undefined ? (result.stderr ?? '') : result.error.message,
  };
};

export const createShellAdapter = (): ShellAdapter => ({ run });
