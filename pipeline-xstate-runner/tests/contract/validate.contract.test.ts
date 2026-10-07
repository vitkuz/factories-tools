/**
 * CONTRACT: this runner's `validate` gives the same verdict as the kit's validate.mjs, run as an
 * external process, for every factory of the kit and every fixture of this tool.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createFileSystemClient } from '../../src/clients/file-system/client.js';
import { listPipelineIdsFactory } from '../../src/features/pipeline/services/locate-pipeline.service.js';
import { toValidationJson } from '../../src/features/report/report.utils.js';
import { validatePipelineUsecaseFactory } from '../../src/features/run/usecases/validate-pipeline.usecase.js';
import { valueOf } from '../../src/shared/utils/result.utils.js';
import { TOOLS_ROOT, fixtureProject } from '../helpers.js';

const project = fixtureProject();
afterAll(() => project.remove());
const fileSystem = createFileSystemClient();
const ids: string[] = listPipelineIdsFactory(fileSystem)(project.root);

interface Verdict {
  ok: boolean;
  rulesRan: boolean;
  errors: string[];
  warnings: string[];
}

/** The kit's validator, as a black box: exit code and --json output. */
const kitVerdict = (id: string): Verdict & { exitCode: number } => {
  try {
    const stdout = execFileSync(
      'node',
      [path.join(TOOLS_ROOT, 'bin', 'validate.mjs'), id, '--json'],
      {
        cwd: project.root,
        encoding: 'utf8',
        env: { ...process.env, LOG_LEVEL: 'error' },
      },
    );
    return { ...(JSON.parse(stdout) as Verdict), exitCode: 0 };
  } catch (error: unknown) {
    const failed = error as { status: number; stdout: string };
    return { ...(JSON.parse(failed.stdout) as Verdict), exitCode: failed.status };
  }
};

const ownVerdict = (id: string): Verdict & { exitCode: number } => {
  const report = toValidationJson(
    valueOf(
      validatePipelineUsecaseFactory({
        fileSystem,
        rootPath: project.root,
        cwd: project.root,
        homePath: process.env['HOME'] ?? '',
      })(id),
    ),
  );
  return {
    ok: report.ok,
    rulesRan: report.rulesRan,
    errors: report.errors,
    warnings: report.warnings,
    exitCode: report.ok ? 0 : 1,
  };
};

describe('validate agrees with factories-tools/bin/validate.mjs', () => {
  it('has pipelines to check', () => expect(ids.length).toBeGreaterThan(5));

  it.each(ids)('%s', (id: string) => {
    const kit = kitVerdict(id);
    const own = ownVerdict(id);
    expect(own.ok).toBe(kit.ok);
    expect(own.exitCode).toBe(kit.exitCode);
    expect(own.rulesRan).toBe(kit.rulesRan);
    expect([...own.errors].sort()).toEqual([...kit.errors].sort());
    expect([...own.warnings].sort()).toEqual([...kit.warnings].sort());
  });
});
