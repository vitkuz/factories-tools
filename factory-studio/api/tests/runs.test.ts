import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunRecord, RunsPayload } from '../src/features/runs/runs.types.js';
import { fakeTmux } from './helpers.js';
import {
  RUN_A_COST,
  RUN_A_STATE,
  buildTestApp,
  listen,
  makeWorkDir,
  rawGet,
  type Listening,
  type RawResponse,
  type WorkDir,
} from './work-dir.js';

describe('runs', () => {
  let work: WorkDir;
  let api: Listening;
  let base: string;

  beforeAll(async () => {
    work = await makeWorkDir();
    api = await listen(buildTestApp(work, fakeTmux().client));
    base = `${api.origin}/api/v1`;
  });
  afterAll(async () => {
    await api.close();
    await work.cleanup();
  });

  const doc = (pipelineId: string, runId: string, rest: string): string =>
    `${base}/runs/${pipelineId}/${runId}/${rest}`;

  const put = (
    url: string,
    body: string,
    contentType: string = 'text/plain; charset=utf-8',
  ): Promise<Response> =>
    fetch(url, { method: 'PUT', headers: { 'content-type': contentType }, body });

  describe('E6 GET /runs', () => {
    it('answers the dashboard envelope, fresh, with no-store', async () => {
      const res: Response = await fetch(`${base}/runs`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body: RunsPayload = (await res.json()) as RunsPayload;
      expect(new Date(body.generatedAt).toISOString()).toBe(body.generatedAt);
      expect(Object.keys(body.pipelines)).toEqual([
        'canonical-factory',
        'local-factory',
        'other-factory',
        'unwrapped-factory',
      ]);

      const ids: string[] = body.runs.map((r: RunRecord): string => r.runId);
      expect(ids).toEqual(['run-a', 'run-d', 'run-b']);
      expect(body.runs[0]).toEqual({
        runId: 'run-a',
        pipelineId: 'canonical-factory',
        dir: 'run/canonical-factory/run-a',
        hasState: true,
        state: RUN_A_STATE,
        cost: RUN_A_COST,
        hasCost: true,
      });
      expect(body.runs[1]).toMatchObject({
        runId: 'run-d',
        pipelineId: 'legacy-factory',
        hasState: true,
        cost: null,
        hasCost: true,
      });
      expect(body.runs[2]).toEqual({
        runId: 'run-b',
        pipelineId: 'canonical-factory',
        dir: 'run/canonical-factory/run-b',
        hasState: false,
        state: null,
        cost: null,
        hasCost: false,
      });
      expect(ids).not.toContain('run-c');
    });

    it('a state.json written after the first call appears on the next, sorted by createdAt', async () => {
      const runDir: string = path.join(work.dir, 'run', 'canonical-factory', 'run-e');
      await mkdir(runDir, { recursive: true });
      await writeFile(
        path.join(runDir, 'state.json'),
        JSON.stringify({
          pipelineName: 'canonical-factory',
          createdAt: '2026-09-16T00:00:00.000Z',
          status: 'DONE',
        }),
      );
      await writeFile(
        path.join(runDir, 'pipeline.json'),
        JSON.stringify({ id: 'canonical-factory', steps: { x: {} } }),
      );
      const body: RunsPayload = (await (await fetch(`${base}/runs`)).json()) as RunsPayload;
      expect(body.runs.map((r: RunRecord): string => r.runId)).toEqual([
        'run-e',
        'run-a',
        'run-d',
        'run-b',
      ]);
      expect(body.runs[0]?.pipeline).toEqual({ id: 'canonical-factory', steps: { x: {} } });

      await writeFile(path.join(runDir, 'state.json'), '{ garbage');
      const again: RunsPayload = (await (await fetch(`${base}/runs`)).json()) as RunsPayload;
      expect(again.runs.map((r: RunRecord): string => r.runId)).toEqual([
        'run-a',
        'run-d',
        'run-b',
      ]);
    });
  });

  describe('E7 GET /runs/:pipelineId/:runId/<path>', () => {
    it('a file with its content type', async () => {
      const res: Response = await fetch(doc('canonical-factory', 'run-a', '3-write-prd/prd.md'));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.text()).toBe('# PRD\n');
    });
    it('a missing document is 200 missing', async () => {
      const res: Response = await fetch(doc('canonical-factory', 'run-a', '9-later/not-yet.md'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ kind: 'missing', path: '9-later/not-yet.md' });
    });
    it('a folder is a listing', async () => {
      const res: Response = await fetch(doc('canonical-factory', 'run-a', '3-write-prd/'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        kind: 'directory',
        path: '3-write-prd/',
        entries: [
          { name: 'logo.png', type: 'file', size: 3 },
          { name: 'prd.md', type: 'file', size: 6 },
        ],
      });
    });
    it('a run filed under another folder resolves through its state file', async () => {
      const res: Response = await fetch(doc('legacy-factory', 'run-d', 'state.json'));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    });
    it('404 run not found for an unknown run, 400 for a bad path', async () => {
      const unknown: Response = await fetch(doc('canonical-factory', 'nope', 'x.md'));
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toMatchObject({ error: 'run not found' });
      const bad: RawResponse = await rawGet(
        api.origin,
        '/api/v1/runs/canonical-factory/run-a/../../../.env',
      );
      expect(bad.status).toBe(400);
      expect(JSON.parse(bad.body)).toMatchObject({ error: 'invalid path segment' });
      const encoded: RawResponse = await rawGet(
        api.origin,
        '/api/v1/runs/canonical-factory/run-a/%2e%2e/%2e%2e/.env',
      );
      expect(encoded.status).toBe(400);
      const rawIds: RawResponse = await rawGet(api.origin, '/api/v1/runs/../../x.md');
      expect(rawIds.status).toBe(404);
      expect(JSON.parse(rawIds.body)).toMatchObject({ error: 'run not found' });
      const escaped: Response = await fetch(`${base}/runs/..%2F..%2Fx/y/z.md`);
      expect(escaped.status).toBe(404);
    });
  });

  describe('E8 PUT /runs/:pipelineId/:runId/<path>', () => {
    it('creates a document with its parents and reports the bytes', async () => {
      const text: string = 'hello — écrit\n';
      const res: Response = await put(doc('canonical-factory', 'run-a', '0-verify/input.md'), text);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ kind: 'saved', bytes: Buffer.byteLength(text, 'utf8') });
      const file: string = path.join(
        work.dir,
        'run',
        'canonical-factory',
        'run-a',
        '0-verify',
        'input.md',
      );
      expect(await readFile(file, 'utf8')).toBe(text);
      const back: Response = await fetch(doc('canonical-factory', 'run-a', '0-verify/input.md'));
      expect(await back.text()).toBe(text);
    });
    it('overwrites an existing document atomically (no temp file left behind)', async () => {
      const res: Response = await put(
        doc('canonical-factory', 'run-a', '3-write-prd/prd.md'),
        '# PRD v2\n',
      );
      expect(res.status).toBe(200);
      const dir: string = path.join(work.dir, 'run', 'canonical-factory', 'run-a', '3-write-prd');
      expect(await readFile(path.join(dir, 'prd.md'), 'utf8')).toBe('# PRD v2\n');
      const listing = (await (
        await fetch(doc('canonical-factory', 'run-a', '3-write-prd/'))
      ).json()) as { entries: { name: string }[] };
      expect(listing.entries.map((e): string => e.name)).toEqual(['logo.png', 'prd.md']);
    });
    it('400 a folder cannot be written', async () => {
      const res: Response = await put(doc('canonical-factory', 'run-a', '3-write-prd/'), 'x');
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'a folder cannot be written' });
    });
    it('400 not a file when the path is an existing folder', async () => {
      await mkdir(path.join(work.dir, 'run', 'canonical-factory', 'run-a', 'folder.md'), {
        recursive: true,
      });
      const res: Response = await put(doc('canonical-factory', 'run-a', 'folder.md'), 'x');
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'not a file' });
    });
    it('415 for a .png', async () => {
      const res: Response = await put(doc('canonical-factory', 'run-a', 'image.png'), 'x');
      expect(res.status).toBe(415);
      expect(await res.json()).toMatchObject({ error: 'only text documents can be edited' });
      await expect(
        stat(path.join(work.dir, 'run', 'canonical-factory', 'run-a', 'image.png')),
      ).rejects.toThrow();
    });
    it('404 run not found', async () => {
      const res: Response = await put(doc('x', 'y', 'z.md'), 'x');
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: 'run not found' });
    });
    it('413 for 3 MB', async () => {
      const res: Response = await put(
        doc('canonical-factory', 'run-a', 'big.md'),
        'a'.repeat(3 * 1024 * 1024),
      );
      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ error: 'document too large' });
      await expect(
        stat(path.join(work.dir, 'run', 'canonical-factory', 'run-a', 'big.md')),
      ).rejects.toThrow();
    });
    it('403 for a path that resolves outside the run', async () => {
      const res: Response = await put(doc('canonical-factory', 'run-a', '..%2Fescape.md'), 'x');
      expect([400, 403]).toContain(res.status);
    });

    describe('a body sent as application/json is written as the raw text it is', () => {
      it('valid JSON lands byte for byte and reads back the same', async () => {
        const text: string = '{"a":1}';
        const res: Response = await put(
          doc('canonical-factory', 'run-a', 'probe.json'),
          text,
          'application/json',
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ kind: 'saved', bytes: 7 });
        const file: string = path.join(work.dir, 'run', 'canonical-factory', 'run-a', 'probe.json');
        expect(await readFile(file, 'utf8')).toBe(text);
        const back: Response = await fetch(doc('canonical-factory', 'run-a', 'probe.json'));
        expect(back.status).toBe(200);
        expect(await back.text()).toBe(text);
      });
      it('malformed JSON is not a 400: the five bytes are written as text', async () => {
        const res: Response = await put(
          doc('canonical-factory', 'run-a', 'probe.md'),
          '{bad',
          'application/json',
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ kind: 'saved', bytes: 4 });
        const file: string = path.join(work.dir, 'run', 'canonical-factory', 'run-a', 'probe.md');
        expect(await readFile(file, 'utf8')).toBe('{bad');
      });
      it('a JSON-typed body past 2 MB is still 413', async () => {
        const res: Response = await put(
          doc('canonical-factory', 'run-a', 'big.json'),
          `{"a":"${'a'.repeat(3 * 1024 * 1024)}"}`,
          'application/json',
        );
        expect(res.status).toBe(413);
        expect(await res.json()).toMatchObject({ error: 'document too large' });
        await expect(
          stat(path.join(work.dir, 'run', 'canonical-factory', 'run-a', 'big.json')),
        ).rejects.toThrow();
      });
    });

    describe("the recorder's own files are never written", () => {
      it('400 for state.json, and the file on disk is untouched', async () => {
        const file: string = path.join(work.dir, 'run', 'canonical-factory', 'run-a', 'state.json');
        const before: string = await readFile(file, 'utf8');
        const res: Response = await put(doc('canonical-factory', 'run-a', 'state.json'), '{}');
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: 'state.json belongs to the recorder' });
        expect(await readFile(file, 'utf8')).toBe(before);
      });
      it('400 for cost.json, and the file on disk is untouched', async () => {
        const file: string = path.join(work.dir, 'run', 'canonical-factory', 'run-a', 'cost.json');
        const before: string = await readFile(file, 'utf8');
        const res: Response = await put(doc('canonical-factory', 'run-a', 'cost.json'), '{}');
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: 'cost.json belongs to the recorder' });
        expect(await readFile(file, 'utf8')).toBe(before);
      });
      it('400 at any depth, and nothing is created', async () => {
        const res: Response = await put(
          doc('canonical-factory', 'run-a', '9-later/state.json'),
          '{}',
        );
        expect(res.status).toBe(400);
        await expect(
          stat(path.join(work.dir, 'run', 'canonical-factory', 'run-a', '9-later', 'state.json')),
        ).rejects.toThrow();
      });
    });
  });
});
