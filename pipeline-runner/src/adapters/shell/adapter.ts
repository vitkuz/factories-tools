import type { ShellResult } from '../../features/run/index.js';
import { runProcess, type ProcessResult } from '../../shared/utils/process.utils.js';
import type { ShellAdapter, ShellAdapterSettings } from './types.js';

/** A hook is a line of shell, written by the pipeline's author, so it is given to a shell as one. */
const runFactory =
  (settings: ShellAdapterSettings) =>
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

export const createShellAdapter = (settings: ShellAdapterSettings): ShellAdapter => ({
  run: runFactory(settings),
});
