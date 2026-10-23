import { lstat, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunRecord, RunsPayload } from '../src/features/runs/runs.types.js';
import { fakeHerdr, workspace, type FakeHerdr, type FakeWorkspace } from './helpers.js';
import {
  buildTestApp,
  listen,
  makeWorkDir,
  rawRequest,
  type Listening,
  type RawResponse,
  type WorkDir,
} from './work-dir.js';

const NOW: Date = new Date('2026-10-24T10:15:30.123Z');
const STAMP = '20261024T101530123Z';

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

describe('DELETE /runs/:pipelineId/:runId', () => {
  let work: WorkDir;
  let herdr: FakeHerdr;
  let api: Listening;
  let base: string;

  const runDir = (...segments: string[]): string => path.join(work.dir, 'run', ...segments);

  const makeRun = async (
    pipelineId: string,
    runId: string,
    state: Record<string, unknown>,
  ): Promise<void> => {
    await mkdir(runDir(pipelineId, runId, '1-step'), { recursive: true });
    await writeFile(runDir(pipelineId, runId, 'state.json'), json(state));
    await writeFile(runDir(pipelineId, runId, '1-step', 'out.md'), '# out\n');
  };

  const remove = (pipelineId: string, runId: string): Promise<Response> =>
    fetch(`${base}/runs/${pipelineId}/${runId}`, { method: 'DELETE' });

  const listed = async (): Promise<RunRecord[]> =>
    ((await (await fetch(`${base}/runs`)).json()) as RunsPayload).runs;

  const exists = async (file: string): Promise<boolean> =>
    stat(file).then(
      (): boolean => true,
      (): boolean => false,
    );

  beforeAll(async () => {
    work = await makeWorkDir();
    const live: FakeWorkspace = {
      ...workspace('w1', 'factory-canonical-live01', 'working'),
      agentSessionId: 'claude-live-1',
    };
    herdr = fakeHerdr([live]);
    api = await listen(buildTestApp(work, herdr.client, { now: (): Date => NOW }));
    base = `${api.origin}/api/v1`;
  });
  afterAll(async () => {
    await api.close();
    await work.cleanup();
  });

  it('moves the run whole to run/.trash/<pipeline>/<runId>-<stamp>, and the feed drops it', async () => {
    await makeRun('canonical-factory', 'gone-1', {
      pipelineName: 'canonical-factory',
      createdAt: '2026-10-20T00:00:00.000Z',
      status: 'COMPLETED',
    });
    expect((await listed()).map((r: RunRecord): string => r.runId)).toContain('gone-1');

    const res: Response = await remove('canonical-factory', 'gone-1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      removed: {
        pipelineId: 'canonical-factory',
        runId: 'gone-1',
        from: 'run/canonical-factory/gone-1',
        trashedTo: `run/.trash/canonical-factory/gone-1-${STAMP}`,
      },
    });
    expect(await exists(runDir('canonical-factory', 'gone-1'))).toBe(false);
    const trashed: string = runDir('.trash', 'canonical-factory', `gone-1-${STAMP}`);
    expect(await readFile(path.join(trashed, '1-step', 'out.md'), 'utf8')).toBe('# out\n');

    const runs: RunRecord[] = await listed();
    expect(runs.map((r: RunRecord): string => r.runId)).not.toContain('gone-1');
    // `.trash` is not a pipeline folder: none of its contents surfaces as a run.
    expect(runs.some((r: RunRecord): boolean => r.dir.includes('.trash'))).toBe(false);
    expect(runs.map((r: RunRecord): string => r.runId)).toEqual(['run-a', 'run-d', 'run-b']);
  });

  it('a trashed run is no longer readable through the run routes', async () => {
    const res: Response = await fetch(`${base}/runs/canonical-factory/gone-1/state.json`);
    expect(res.status).toBe(404);
    const viaTrash: Response = await fetch(
      `${base}/runs/.trash/canonical-factory/gone-1-${STAMP}/state.json`,
    );
    expect(viaTrash.status).toBe(404);
  });

  it('400 for `..`, separators, hidden folders and odd ids, and nothing moves', async () => {
    const paths: string[] = [
      '/api/v1/runs/../run-a',
      '/api/v1/runs/canonical-factory/..',
      '/api/v1/runs/canonical-factory/run..a',
      '/api/v1/runs/..%2F..%2Fx/run-a',
      '/api/v1/runs/canonical-factory/run-a%2F..',
      '/api/v1/runs/.trash/canonical-factory',
      '/api/v1/runs/canonical-factory/run%20a',
      '/api/v1/runs/canonical-factory/%2e%2e',
    ];
    for (const rawPath of paths) {
      const res: RawResponse = await rawRequest(api.origin, rawPath, 'DELETE');
      expect(res.status, rawPath).toBe(400);
      expect(JSON.parse(res.body), rawPath).toMatchObject({ error: 'invalid run id' });
    }
    expect(await exists(runDir('canonical-factory', 'run-a', 'state.json'))).toBe(true);
  });

  it('404 for a run that is not there', async () => {
    const res: Response = await remove('canonical-factory', 'no-such-run');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'run not found' });
  });

  it('403 for a symlinked run folder: neither the link nor its target moves', async () => {
    const outside: string = path.join(work.dir, 'elsewhere', 'real-run');
    await mkdir(outside, { recursive: true });
    await writeFile(
      path.join(outside, 'state.json'),
      json({ pipelineName: 'canonical-factory', status: 'COMPLETED' }),
    );
    await symlink(outside, runDir('canonical-factory', 'linked'));

    const res: Response = await remove('canonical-factory', 'linked');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('symlink') });
    expect((await lstat(runDir('canonical-factory', 'linked'))).isSymbolicLink()).toBe(true);
    expect(await exists(path.join(outside, 'state.json'))).toBe(true);
    expect(await exists(runDir('.trash', 'canonical-factory', `linked-${STAMP}`))).toBe(false);
  });

  it('409 for a run a live studio session is still in, with the session named', async () => {
    await makeRun('canonical-factory', 'live-run', {
      pipelineName: 'canonical-factory',
      createdAt: '2026-10-23T00:00:00.000Z',
      status: 'RUNNING',
      sessionId: 'claude-live-1',
    });
    const res: Response = await remove('canonical-factory', 'live-run');
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining('factory-canonical-live01'),
      details: { session: 'factory-canonical-live01' },
    });
    expect(await exists(runDir('canonical-factory', 'live-run', 'state.json'))).toBe(true);
  });

  it('a run that says RUNNING but whose session is gone is dead, and goes', async () => {
    await makeRun('canonical-factory', 'dead-run', {
      pipelineName: 'canonical-factory',
      createdAt: '2026-10-21T00:00:00.000Z',
      status: 'RUNNING',
      sessionId: 'claude-long-gone',
    });
    const res: Response = await remove('canonical-factory', 'dead-run');
    expect(res.status).toBe(200);
    expect(await exists(runDir('.trash', 'canonical-factory', `dead-run-${STAMP}`))).toBe(true);
  });

  it('once the live session is gone, its run may go too', async () => {
    herdr.workspaces.splice(0, herdr.workspaces.length);
    const res: Response = await remove('canonical-factory', 'live-run');
    expect(res.status).toBe(200);
    expect((await listed()).map((r: RunRecord): string => r.runId)).not.toContain('live-run');
  });
});
