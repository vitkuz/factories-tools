export interface ShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ShellAdapter {
  /** Runs a command to completion and hands back what it printed; never throws on a non-zero exit. */
  run: (command: string, args: readonly string[], cwd: string) => ShellResult;
}
