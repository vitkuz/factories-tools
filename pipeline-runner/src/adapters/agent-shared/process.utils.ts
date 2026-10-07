import type { PermissionMode } from '../../features/harness/index.js';
import { createAppError, type AppError } from '../../shared/utils/error.utils.js';
import type { ProcessResult } from '../../shared/utils/process.utils.js';
import { tail } from './answer.utils.js';

/** What every harness has in common when it did not answer: killed, or nothing on stdout. */
export const processFailureOf =
  (name: string, timeoutMs: number) =>
  (done: ProcessResult): string | undefined => {
    if (done.killed === 'timeout')
      return `${name} was killed after ${Math.round(timeoutMs / 60000)} minutes`;
    if (done.killed === 'aborted') return `${name} was stopped because the run was aborted`;
    if (done.stdout.trim() === '')
      return `${name} exited ${done.exitCode} with no result: ${tail(done.stderr)}`;
    return undefined;
  };

/**
 * A mode a harness has no honest equivalent for is refused, never widened: a step that was asked
 * to run tighter must not quietly run with everything allowed.
 */
export const unsupportedMode = (
  harness: string,
  mode: PermissionMode,
  supported: readonly string[],
): AppError =>
  createAppError(
    'PERMISSION_MODE_UNSUPPORTED',
    `${harness} has no equivalent of permission mode "${mode}"`,
    [`${harness} supports: ${supported.join(', ')}`],
  );
