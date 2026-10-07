import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fakeTmux } from './helpers.js';
import { buildTestApp, listen, makeWorkDir, type Listening, type WorkDir } from './work-dir.js';

const API_KEY = 'test-key-0123456789abcdef';

describe('app', () => {
  let work: WorkDir;
  let open: Listening;
  let locked: Listening;
  let bare: Listening;

  beforeAll(async () => {
    work = await makeWorkDir();
    open = await listen(buildTestApp(work, fakeTmux().client));
    locked = await listen(buildTestApp(work, fakeTmux().client, { apiKey: API_KEY }));
    bare = await listen(buildTestApp(work, fakeTmux().client, { webDist: null }));
  });
  afterAll(async () => {
    await Promise.all([open.close(), locked.close(), bare.close()]);
    await work.cleanup();
  });

  it('GET /health is 200 { ok: true } with an x-request-id', async () => {
    const res: Response = await fetch(`${open.origin}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('an unknown /api/v1 path is a JSON 404, never the page', async () => {
    const res: Response = await fetch(`${open.origin}/api/v1/nothing`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'not found' });
    const deeper: Response = await fetch(`${open.origin}/api/other`);
    expect(deeper.status).toBe(404);
    expect(await deeper.json()).toEqual({ error: 'not found' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('malformed JSON is a 400', async () => {
    const res: Response = await fetch(`${open.origin}/api/v1/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/malformed JSON body/);
  });

  describe('api key', () => {
    it('unset: every route is open', async () => {
      const res: Response = await fetch(`${open.origin}/api/v1/pipelines`);
      expect(res.status).toBe(200);
    });
    it('set: missing or wrong is 401 unauthorized and the key never echoes back', async () => {
      const missing: Response = await fetch(`${locked.origin}/api/v1/pipelines`);
      expect(missing.status).toBe(401);
      expect(await missing.json()).toMatchObject({ error: 'unauthorized' });
      const wrong: Response = await fetch(`${locked.origin}/api/v1/pipelines`, {
        headers: { 'x-api-key': 'nope-nope-nope-nope' },
      });
      expect(wrong.status).toBe(401);
      expect(await wrong.text()).not.toContain('nope');
    });
    it('set: the right key is let in, and /health needs none', async () => {
      const right: Response = await fetch(`${locked.origin}/api/v1/pipelines`, {
        headers: { 'x-api-key': API_KEY },
      });
      expect(right.status).toBe(200);
      const health: Response = await fetch(`${locked.origin}/health`);
      expect(health.status).toBe(200);
    });
  });

  describe('static app', () => {
    it('GET / answers index.html', async () => {
      const expected: string = await readFile(path.join(work.webDist, 'index.html'), 'utf8');
      const res: Response = await fetch(`${open.origin}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(await res.text()).toBe(expected);
    });
    it('GET /runs/x/y (a client route) answers index.html too', async () => {
      const expected: string = await readFile(path.join(work.webDist, 'index.html'), 'utf8');
      const res: Response = await fetch(`${open.origin}/runs/x/y`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(expected);
    });
    it('a static asset is served as itself', async () => {
      const res: Response = await fetch(`${open.origin}/assets/app.js`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('console.log("app")\n');
    });
    it('GET /api/v1/runs/x/y/z.md stays a JSON 404', async () => {
      const res: Response = await fetch(`${open.origin}/api/v1/runs/x/y/z.md`);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: 'run not found' });
    });
    it('a POST outside /api is a JSON 404', async () => {
      const res: Response = await fetch(`${open.origin}/runs`, { method: 'POST' });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not found' });
    });
    it('without a webDist, GET / is a JSON 404', async () => {
      const res: Response = await fetch(`${bare.origin}/`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not found' });
    });
  });
});
