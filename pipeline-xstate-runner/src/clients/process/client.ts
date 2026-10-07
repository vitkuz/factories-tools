// Learned from factories-tools/pipeline-runner/src/shared/utils/process.utils.ts
import { spawn } from 'node:child_process';
import type { ProcessRequest, ProcessResult, RunProcess } from './types.js';

/**
 * One child process, argv as an array — no shell between this process and the binary, so nothing
 * needs quoting. Resolves whatever the exit code; rejects only when the binary cannot be started.
 */
export const runProcess: RunProcess = ({
  bin,
  args,
  cwd,
  input,
  timeoutMs,
  signal,
}: ProcessRequest): Promise<ProcessResult> =>
  new Promise<ProcessResult>((resolve, reject): void => {
    const child = spawn(bin, [...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: { stdout: Buffer[]; stderr: Buffer[] } = { stdout: [], stderr: [] };
    const reasons: ('timeout' | 'aborted')[] = [];

    const kill = (reason: 'timeout' | 'aborted') => (): void => {
      reasons.push(reason);
      child.kill('SIGTERM');
    };
    const onAbort = kill('aborted');
    const timer: NodeJS.Timeout | undefined =
      timeoutMs === undefined ? undefined : setTimeout(kill('timeout'), timeoutMs);
    if (signal?.aborted === true) onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk: Buffer): void => void chunks.stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer): void => void chunks.stderr.push(chunk));
    child.on('error', (error: Error): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.on('close', (code: number | null): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(chunks.stdout).toString('utf8'),
        stderr: Buffer.concat(chunks.stderr).toString('utf8'),
        ...(reasons[0] === undefined ? {} : { killed: reasons[0] }),
      });
    });
    child.stdin.on('error', (): void => undefined);
    child.stdin.end(input ?? '');
  });
