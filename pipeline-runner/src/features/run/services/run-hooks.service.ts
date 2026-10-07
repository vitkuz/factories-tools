import type { LoggerPort } from '../../../shared/types/logger.types.js';
import type { HookReport, ShellPort, ShellResult } from '../run.types.js';

export interface RunHooksDeps {
  shell: ShellPort;
  logger: LoggerPort;
}

/**
 * Hooks run in order, from the repository root, by the runner — never by a subagent.
 * `before` stops at the first failure (nothing has been spawned yet, so nothing should be);
 * `after` runs to the end whatever happens, because the run is already over.
 */
export const runHooksFactory =
  (deps: RunHooksDeps) =>
  (phase: 'before' | 'after', cwd: string) =>
  async (commands: readonly string[]): Promise<HookReport[]> => {
    const runFrom = async (
      rest: readonly string[],
      done: readonly HookReport[],
    ): Promise<HookReport[]> => {
      const [command, ...others] = rest;
      if (command === undefined) return [...done];
      deps.logger.info(`hook ${phase}: ${command}`);
      const result: ShellResult = await deps.shell.run(command, cwd);
      const reports: HookReport[] = [...done, { ...result, phase }];
      if (result.exitCode !== 0)
        deps.logger.warn(`hook ${phase} exited ${result.exitCode}`, {
          output: result.output.slice(-2000),
        });
      return result.exitCode !== 0 && phase === 'before' ? reports : runFrom(others, reports);
    };
    return runFrom(commands, []);
  };

export const hooksFailed = (reports: readonly HookReport[]): boolean =>
  reports.some((report: HookReport): boolean => report.exitCode !== 0);
