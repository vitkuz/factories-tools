export type AppErrorCode =
  | 'PIPELINE_NOT_FOUND'
  | 'PIPELINE_INVALID'
  | 'PARAMS_INVALID'
  | 'VARIABLES_INVALID'
  | 'WORKSPACE_INVALID'
  | 'RUN_FOLDER_TAKEN'
  | 'RUN_NOT_RESUMABLE'
  | 'CONDITION_INVALID'
  | 'HARNESS_INVALID'
  | 'PERMISSION_MODE_UNSUPPORTED';

/** An error this tool raised on purpose: the CLI prints its lines and exits 1, no stack. */
export interface AppError extends Error {
  code: AppErrorCode;
  issues: string[];
}

/** No classes here, so an AppError is a plain Error carrying a code and its issue list. */
export const createAppError = (
  code: AppErrorCode,
  message: string,
  issues: string[] = [],
): AppError => Object.assign(new Error(message), { code, issues });

export const isAppError = (error: unknown): error is AppError =>
  error instanceof Error && 'code' in error && 'issues' in error;

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
