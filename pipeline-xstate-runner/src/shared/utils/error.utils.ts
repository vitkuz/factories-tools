// Learned from factories-tools/run-state/src/shared/utils/error.utils.ts
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
