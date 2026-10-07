/** The bundled CLI as a black box: exit codes and the shape of what it prints. */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BUNDLE_FILE } from '../../esbuild.config.mjs';
import { fixtureProject, runDirOf } from '../helpers.js';

const project = fixtureProject(['linear', 'human-gate', 'condition-unknown']);
afterAll(() => project.remove());

const cli = (...args: string[]): { code: number; stdout: string; stderr: string } => {
  const done = spawnSync('node', [BUNDLE_FILE, ...args], {
    cwd: project.root,
    encoding: 'utf8',
    env: { ...process.env, LOG_LEVEL: 'error', CLAUDE_SESSION_ID: '' },
  });
  return { code: done.status ?? 1, stdout: done.stdout, stderr: done.stderr };
};

const scriptFile = (name: string, script: unknown): string => {
  const file: string = path.join(project.root, `${name}.json`);
  writeFileSync(file, JSON.stringify(script));
  return file;
};

describe('xstate-runner (the bundle)', () => {
  it('lists its guards and harnesses', () => {
    expect(cli('--list-guards')).toMatchObject({
      code: 0,
      stdout: expect.stringContaining('cap-is-spent'),
    });
    expect(cli('--list-harnesses')).toMatchObject({
      code: 0,
      stdout: expect.stringMatching(/^claude .*\nscripted /),
    });
  });

  it("validate: the kit's exit codes (0 ok, 1 errors, 2 usage)", () => {
    expect(cli('validate', 'linear').code).toBe(0);
    expect(cli('validate', 'linear', '--json').stdout).toContain('"ok": true');
    expect(cli('validate', 'no-such-pipeline')).toMatchObject({
      code: 2,
      stderr: expect.stringContaining('refused'),
    });
  });

  it('run: 0 when COMPLETED, 2 when refused before opening, 1 when the run fails', () => {
    const script = scriptFile('linear', {
      a: [{ event: 'DONE', writes: { '1-a/out.md': 'a' } }],
      b: [{ event: 'DONE', writes: { '2-b/out.md': 'b' } }],
      c: [{ event: 'DONE', writes: { '3-c/out.md': 'c' } }],
    });
    const run = cli('run', 'linear', '--harness', 'scripted', '--script', script, '--json');
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ status: 'COMPLETED', endedBy: ['c:DONE'] });
    expect(cli('show', runDirOf(project.root, 'linear')).stdout).toContain('"status": "COMPLETED"');
    expect(cli('replay', runDirOf(project.root, 'linear'))).toMatchObject({
      code: 0,
      stdout: expect.stringContaining('reproduced exactly'),
    });
    expect(cli('resume', runDirOf(project.root, 'linear')).code).toBe(2);
    expect(
      cli('run', 'linear', '-p', 'nope=1', '--harness', 'scripted', '--script', script).code,
    ).toBe(2);

    const refused = cli(
      'run',
      'condition-unknown',
      '--harness',
      'scripted',
      '--script',
      scriptFile('judge', { judge: [{ event: 'DONE' }] }),
    );
    expect(refused.code).toBe(1);
  });

  it('run: 3 when parked for a person; answer continues it', () => {
    const script = scriptFile('human-gate', {
      draft: [{ event: 'DONE', writes: { '1-draft/draft.md': 'd' } }],
    });
    const parked = cli(
      'run',
      'human-gate',
      '--harness',
      'scripted',
      '--script',
      script,
      '--human',
      'park',
    );
    expect(parked.code).toBe(3);
    expect(parked.stdout).toContain('waiting at   approve');
    const runDir: string = runDirOf(project.root, 'human-gate');
    expect(cli('answer', runDir, 'approve', 'MAYBE', '--harness', 'scripted').code).toBe(2);
    expect(
      cli('answer', runDir, 'approve', 'APPROVE', '--harness', 'scripted', '--script', script).code,
    ).toBe(0);
  });

  it('resolve --prompt prints the task message', () => {
    expect(cli('resolve', 'linear', '--prompt', 'b').stdout).toContain('## Events');
    expect(cli('compile', 'linear').stdout).toContain('"initial": "a"');
  });
});
