export interface ProcessRequest {
  bin: string;
  args: readonly string[];
  cwd: string;
  /** Written to stdin, then stdin is closed. */
  input?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Why it was killed, when it was. */
  killed?: 'timeout' | 'aborted';
}

export type RunProcess = (request: ProcessRequest) => Promise<ProcessResult>;
