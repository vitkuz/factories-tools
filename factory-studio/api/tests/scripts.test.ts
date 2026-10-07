import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fakeTmux } from './helpers.js';
import {
  buildTestApp,
  listen,
  makeWorkDir,
  rawGet,
  type Listening,
  type RawResponse,
  type WorkDir,
} from './work-dir.js';

describe('scripts', () => {
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

  const script = (rest: string): string => `${base}/scripts/${rest}`;

  describe('E12 GET /scripts/<path>', () => {
    it('a text script with its content type, no-store', async () => {
      const res: Response = await fetch(script('sync.sh'));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.text()).toBe('#!/usr/bin/env bash\necho sync "$1"\n');
    });
    it('a script in a sub-folder', async () => {
      const res: Response = await fetch(script('tools/ingest.py'));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('print("ingest")\n');
    });
    it('404 for a missing script, and folders are never listed', async () => {
      expect((await fetch(script('nope.sh'))).status).toBe(404);
      expect((await fetch(script('tools/'))).status).toBe(404);
      expect((await fetch(script('tools'))).status).toBe(404);
    });
    it('415 for a file that is not text', async () => {
      const res: Response = await fetch(script('logo.png'));
      expect(res.status).toBe(415);
      expect(await res.json()).toMatchObject({ error: 'only text scripts can be read' });
    });
    it('413 past 1 MB', async () => {
      const res: Response = await fetch(script('huge.sh'));
      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ error: 'script too large' });
    });
    it('403 for a symlink that leaves scripts/', async () => {
      const res: Response = await fetch(script('escape.md'));
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: 'outside the scripts folder' });
    });
    it('400 for `..`, an encoded `..` and an absolute path', async () => {
      const dotdot: RawResponse = await rawGet(api.origin, '/api/v1/scripts/../knowledge/one.md');
      expect(dotdot.status).toBe(400);
      const encoded: RawResponse = await rawGet(api.origin, '/api/v1/scripts/%2e%2e/one.md');
      expect(encoded.status).toBe(400);
      const absolute: RawResponse = await rawGet(api.origin, '/api/v1/scripts/%2Fetc%2Fpasswd');
      expect(absolute.status).toBe(400);
    });
    it('never writes: PUT is not a route', async () => {
      const res: Response = await fetch(script('sync.sh'), { method: 'PUT', body: 'x' });
      expect(res.status).toBe(404);
    });
  });
});
