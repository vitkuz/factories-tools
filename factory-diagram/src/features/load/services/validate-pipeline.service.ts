import type { FileSystemAdapter } from '../../../adapters/file-system/index.js';
import type { ShellAdapter, ShellResult } from '../../../adapters/shell/index.js';
import { createAppError } from '../../../shared/utils/error.utils.js';
import type { ValidationOutcome, ValidatorReport } from '../load.types.js';
import { classifyValidation, isInsideFactories, validatorPath } from '../load.utils.js';

const isReport = (value: unknown): value is ValidatorReport => {
  const report = value as Record<string, unknown> | null;
  return (
    typeof report === 'object' &&
    report !== null &&
    typeof report['ok'] === 'boolean' &&
    Array.isArray(report['errors']) &&
    Array.isArray(report['warnings'])
  );
};

const parseReport = (file: string, result: ShellResult): ValidatorReport => {
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (isReport(parsed)) return parsed;
  } catch {
    // fall through to the error below
  }
  throw createAppError('VALIDATOR_UNAVAILABLE', `the shared validator gave no report for ${file}`, [
    `exit ${result.exitCode}`,
    ...result.stderr.split('\n').filter(Boolean),
  ]);
};

/**
 * One source of truth for "valid pipeline": the kit's `factories-tools/bin/validate.mjs`,
 * run from the project root as the harness would, read through its `--json` report.
 */
export const validatePipelineFactory =
  (fileSystem: FileSystemAdapter, shell: ShellAdapter) =>
  (rootPath: string) =>
  (file: string, legacy: boolean): ValidationOutcome => {
    const validator: string = validatorPath(rootPath);
    if (!fileSystem.exists(validator)) {
      throw createAppError('VALIDATOR_UNAVAILABLE', `shared validator not found at ${validator}`, [
        'pass --root <project root> (the folder holding the factories/ kit)',
      ]);
    }
    const result: ShellResult = shell.run(
      process.execPath,
      [validator, file, '--root', rootPath, '--json'],
      rootPath,
    );
    return classifyValidation(parseReport(file, result), legacy, isInsideFactories(rootPath, file));
  };
