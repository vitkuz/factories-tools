// Learned from factories-tools/pipeline-runner/src/adapters/shell/adapter.ts
import { runProcess } from '../process/client.js';
import type { ProcessResult } from '../process/types.js';
import type { ShellClient, ShellClientSettings, ShellResult } from './types.js';

/** A hook is a line of shell, written by the pipeline's author, so it is given to a shell as one. */
const runFactory =
  (settings: ShellClientSettings) =>
  async (command: string, cwd: string): Promise<ShellResult> => {
    settings.logger?.debug('shell request', { command, cwd });
    const done: ProcessResult = await (settings.runProcess ?? runProcess)({
      bin: settings.shell,
      args: ['-c', command],
      cwd,
      timeoutMs: settings.timeoutMs,
    });
    settings.logger?.debug('shell response', { command, exitCode: done.exitCode });
    return {
      command,
      exitCode: done.killed === undefined ? done.exitCode : 124,
      output: `${done.stdout}${done.stderr}`,
    };
  };

export const createShellClient = (settings: ShellClientSettings): ShellClient => ({
  run: runFactory(settings),
});
