import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RunRecord, RunsPayload } from '../src/features/runs/runs.types.js';
import type {
  Workspace,
  WorkspacesFile,
  WorkspacesListResponse,
} from '../src/features/workspaces/workspaces.types.js';
import { fakeHerdr } from './helpers.js';
import {
  buildTestApp,
  listen,
  makeWorkDir,
  rawRequest,
  type Listening,
  type RawResponse,
  type WorkDir,
} from './work-dir.js';

interface ErrorAnswer {
  error: string;
  details?: unknown;
}

describe('workspaces', () => {
  let work: WorkDir;
  let api: Listening;
  let base: string;

  const file = (): string => path.join(work.dir, 'run', 'workspaces.json');

  const exists = async (target: string): Promise<boolean> =>
    stat(target).then(
      (): boolean => true,
      (): boolean => false,
    );

  const send = (method: string, url: string, body?: unknown): Promise<Response> =>
    fetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const list = async (): Promise<WorkspacesListResponse> =>
    (await (await fetch(`${base}/workspaces`)).json()) as WorkspacesListResponse;

  const runIds = async (): Promise<string[]> =>
    ((await (await fetch(`${base}/runs`)).json()) as RunsPayload).runs.map(
      (run: RunRecord): string => run.runId,
    );

  beforeAll(async () => {
    work = await makeWorkDir();
    api = await listen(buildTestApp(work, fakeHerdr().client));
    base = `${api.origin}/api/v1`;
  });
  afterAll(async () => {
    await api.close();
    await work.cleanup();
  });
  beforeEach(async () => {
    await rm(file(), { force: true });
  });

  describe('GET /workspaces', () => {
    it('answers no workspaces, fresh, when there is no file', async () => {
      const res: Response = await fetch(`${base}/workspaces`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ exists: false, workspaces: [] });
      expect(await exists(file())).toBe(false);
    });

    it('reads a file written by hand', async () => {
      const written: WorkspacesFile = {
        workspaces: [
          { id: 'mine', name: 'Mine', pipelines: ['canonical-factory', 'gone-factory'] },
        ],
      };
      await writeFile(file(), JSON.stringify(written));
      expect(await list()).toEqual({ exists: true, ...written });
    });
  });

  describe('POST /workspaces', () => {
    it('creates the file pretty, with a slug id, and answers 201', async () => {
      const res: Response = await send('POST', `${base}/workspaces`, {
        name: '  Klevrs Sales!  ',
        pipelines: ['canonical-factory', 'other-factory'],
      });
      expect(res.status).toBe(201);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const workspace: Workspace = {
        id: 'klevrs-sales',
        name: 'Klevrs Sales!',
        pipelines: ['canonical-factory', 'other-factory'],
      };
      expect(await res.json()).toEqual({ workspace });

      const expected: WorkspacesFile = { workspaces: [workspace] };
      expect(await readFile(file(), 'utf8')).toBe(`${JSON.stringify(expected, null, 2)}\n`);
      expect(await list()).toEqual({ exists: true, workspaces: [workspace] });
    });

    it('appends a second workspace and allows ids not on disk and an empty list', async () => {
      await send('POST', `${base}/workspaces`, { name: 'One', pipelines: [] });
      const res: Response = await send('POST', `${base}/workspaces`, {
        name: 'Two',
        pipelines: ['not-yet-written'],
      });
      expect(res.status).toBe(201);
      expect((await list()).workspaces.map((w: Workspace): string => w.id)).toEqual(['one', 'two']);
    });

    it('refuses a name whose id is taken with 409, and leaves the file alone', async () => {
      await send('POST', `${base}/workspaces`, { name: 'Research', pipelines: [] });
      const before: string = await readFile(file(), 'utf8');
      const res: Response = await send('POST', `${base}/workspaces`, {
        name: 'research',
        pipelines: ['canonical-factory'],
      });
      expect(res.status).toBe(409);
      const body: ErrorAnswer = (await res.json()) as ErrorAnswer;
      expect(body.error).toBe('a workspace with id "research" already exists');
      expect(body.details).toEqual({ id: 'research' });
      expect(await readFile(file(), 'utf8')).toBe(before);
    });

    it.each([
      ['an empty name', { name: '   ', pipelines: [] }],
      ['a pipeline id with ..', { name: 'X', pipelines: ['a..b'] }],
      ['a pipeline id with a slash', { name: 'X', pipelines: ['a/b'] }],
      ['duplicate pipelines', { name: 'X', pipelines: ['other-factory', 'other-factory'] }],
      ['a missing pipelines field', { name: 'X' }],
      ['a name past 80 characters', { name: 'x'.repeat(81), pipelines: [] }],
    ])('answers 400 for %s and writes nothing', async (_label: string, body: unknown) => {
      const res: Response = await send('POST', `${base}/workspaces`, body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrorAnswer).error).toBe('invalid request body');
      expect(await exists(file())).toBe(false);
    });

    it('answers 400 for a malformed JSON body', async () => {
      const res: Response = await fetch(`${base}/workspaces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{ nope',
      });
      expect(res.status).toBe(400);
      expect(await exists(file())).toBe(false);
    });
  });

  describe('PUT /workspaces/:id', () => {
    it('replaces the name and pipelines and keeps the id', async () => {
      await send('POST', `${base}/workspaces`, { name: 'Alpha', pipelines: ['canonical-factory'] });
      const res: Response = await send('PUT', `${base}/workspaces/alpha`, {
        name: 'Beta',
        pipelines: ['other-factory', 'local-factory'],
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const workspace: Workspace = {
        id: 'alpha',
        name: 'Beta',
        pipelines: ['other-factory', 'local-factory'],
      };
      expect(await res.json()).toEqual({ workspace });
      expect(await readFile(file(), 'utf8')).toBe(
        `${JSON.stringify({ workspaces: [workspace] }, null, 2)}\n`,
      );
    });

    it('answers 404 for an unknown id', async () => {
      await send('POST', `${base}/workspaces`, { name: 'Alpha', pipelines: [] });
      const res: Response = await send('PUT', `${base}/workspaces/nope`, {
        name: 'X',
        pipelines: [],
      });
      expect(res.status).toBe(404);
      expect(((await res.json()) as ErrorAnswer).error).toBe('workspace not found');
    });

    it('answers 404 when there is no file, and does not create one', async () => {
      const res: Response = await send('PUT', `${base}/workspaces/nope`, {
        name: 'X',
        pipelines: [],
      });
      expect(res.status).toBe(404);
      expect(await exists(file())).toBe(false);
    });

    it('answers 400 for an invalid body', async () => {
      await send('POST', `${base}/workspaces`, { name: 'Alpha', pipelines: [] });
      const res: Response = await send('PUT', `${base}/workspaces/alpha`, { name: '' });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /workspaces/:id', () => {
    it('drops the workspace, rewrites the file and answers what was removed', async () => {
      await send('POST', `${base}/workspaces`, { name: 'One', pipelines: ['canonical-factory'] });
      await send('POST', `${base}/workspaces`, { name: 'Two', pipelines: [] });
      const res: Response = await send('DELETE', `${base}/workspaces/one`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({
        removed: { id: 'one', name: 'One', pipelines: ['canonical-factory'] },
      });
      const remaining: WorkspacesFile = { workspaces: [{ id: 'two', name: 'Two', pipelines: [] }] };
      expect(await readFile(file(), 'utf8')).toBe(`${JSON.stringify(remaining, null, 2)}\n`);
    });

    it('answers 404 for an unknown id', async () => {
      const res: Response = await send('DELETE', `${base}/workspaces/nope`);
      expect(res.status).toBe(404);
      expect(((await res.json()) as ErrorAnswer).error).toBe('workspace not found');
    });
  });

  describe('a bad :id', () => {
    it.each([
      '/api/v1/workspaces/..',
      '/api/v1/workspaces/Upper',
      '/api/v1/workspaces/a%2Fb',
      '/api/v1/workspaces/.hidden',
      '/api/v1/workspaces/%2e%2e',
      '/api/v1/workspaces/-lead',
    ])('answers 400 for %s on DELETE and PUT, before the disk', async (rawPath: string) => {
      for (const method of ['DELETE', 'PUT']) {
        const res: RawResponse = await rawRequest(api.origin, rawPath, method);
        expect(res.status, `${method} ${rawPath}`).toBe(400);
        expect((JSON.parse(res.body) as ErrorAnswer).error).toBe('invalid workspace id');
      }
      expect(await exists(file())).toBe(false);
    });
  });

  describe('a broken file', () => {
    it.each([
      ['not JSON', '{ nope', 'run/workspaces.json is not valid JSON: '],
      [
        'not the schema',
        JSON.stringify({ workspaces: [{ id: 'Bad Id', name: 'x', pipelines: [] }] }),
        'run/workspaces.json does not match the workspaces schema: ',
      ],
      [
        'duplicate ids',
        JSON.stringify({
          workspaces: [
            { id: 'a', name: 'A', pipelines: [] },
            { id: 'a', name: 'B', pipelines: [] },
          ],
        }),
        'run/workspaces.json does not match the workspaces schema: ',
      ],
    ])(
      'is %s: GET answers 200 with a problem, every write is 409, the file is untouched',
      async (_label: string, content: string, problemStart: string) => {
        await writeFile(file(), content);

        const res: Response = await fetch(`${base}/workspaces`);
        expect(res.status).toBe(200);
        const listed: WorkspacesListResponse = (await res.json()) as WorkspacesListResponse;
        expect(listed.exists).toBe(true);
        expect(listed.workspaces).toEqual([]);
        expect(listed.problem?.startsWith(problemStart)).toBe(true);

        const writes: Response[] = [
          await send('POST', `${base}/workspaces`, { name: 'New', pipelines: [] }),
          await send('PUT', `${base}/workspaces/a`, { name: 'New', pipelines: [] }),
          await send('DELETE', `${base}/workspaces/a`),
        ];
        for (const write of writes) {
          expect(write.status).toBe(409);
          const body: ErrorAnswer = (await write.json()) as ErrorAnswer;
          expect(body.error).toBe(
            `run/workspaces.json cannot be changed: ${listed.problem} — fix or remove it by hand`,
          );
        }
        expect(await readFile(file(), 'utf8')).toBe(content);
      },
    );
  });

  it('is never mistaken for a pipeline folder: GET /runs lists the same runs', async () => {
    const before: string[] = await runIds();
    expect(before).toEqual(['run-a', 'run-d', 'run-b']);
    await send('POST', `${base}/workspaces`, { name: 'One', pipelines: ['canonical-factory'] });
    await send('POST', `${base}/workspaces`, { name: 'Two', pipelines: [] });
    expect(await exists(file())).toBe(true);
    expect(await runIds()).toEqual(before);
    const res: Response = await fetch(`${base}/runs`);
    expect(Object.keys(((await res.json()) as RunsPayload).pipelines)).not.toContain(
      'workspaces.json',
    );
  });
});
