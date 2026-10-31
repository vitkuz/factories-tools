import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const API_KEY = 'test-key-0123456789abcdef';
const KP = '%7B%7BknowledgePath%7D%7D';
const ROOT = '%7B%7BrootPath%7D%7D';
const SKILL = '%7B%7BskillPath%7D%7D';
const FACTORY = '%7B%7BfactoryPath%7D%7D';

const sha = (text: string): string =>
  `"${createHash('sha256').update(text, 'utf8').digest('hex')}"`;

describe('knowledge write (E16) and its read signals (E5)', () => {
  let work: WorkDir;
  let api: Listening;
  let locked: Listening;
  let base: string;

  beforeAll(async () => {
    work = await makeWorkDir();
    api = await listen(buildTestApp(work, fakeHerdr().client));
    locked = await listen(buildTestApp(work, fakeHerdr().client, { apiKey: API_KEY }));
    base = `${api.origin}/api/v1`;
  });
  afterAll(async () => {
    await Promise.all([api.close(), locked.close()]);
    await work.cleanup();
  });

  const local = (rest: string): string => `${base}/pipelines/local-factory/knowledge/${rest}`;
  const kit = (rest: string): string => `${base}/pipelines/canonical-factory/knowledge/${rest}`;
  const localFile = (...parts: string[]): string =>
    path.join(work.dir, 'factories.local', 'local-factory', 'knowledge', ...parts);

  const put = (
    url: string,
    body: string,
    headers: Record<string, string> = {},
  ): Promise<Response> =>
    fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'text/plain; charset=utf-8', ...headers },
      body,
    });

  describe('E5 signals', () => {
    it('a local factory knowledge file answers its ETag and X-Doc-Writable: true', async () => {
      const res: Response = await fetch(local(`${KP}/notes.md`));
      expect(res.status).toBe(200);
      expect(res.headers.get('etag')).toBe(sha('# notes\n'));
      expect(res.headers.get('x-doc-writable')).toBe('true');
      expect(await res.text()).toBe('# notes\n');
      const head: Response = await fetch(local(`${KP}/notes.md`), { method: 'HEAD' });
      expect(head.headers.get('etag')).toBe(sha('# notes\n'));
      expect(head.headers.get('x-doc-writable')).toBe('true');
    });

    it.each([
      ['the kit', 'canonical-factory', `${FACTORY}/knowledge/method.md`],
      ['a {{rootPath}} file outside the factory', 'local-factory', `${ROOT}/knowledge/one.md`],
      ['the wrapper skill', 'local-factory', `${SKILL}/SKILL.md`],
      ['an image', 'local-factory', `${KP}/logo.png`],
      ['a linked file', 'local-factory', `${KP}/escape.md`],
    ])('X-Doc-Writable: false for %s', async (_name: string, id: string, rest: string) => {
      const res: Response = await fetch(`${base}/pipelines/${id}/knowledge/${rest}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-doc-writable')).toBe('false');
    });

    it('an image has no ETag', async () => {
      const res: Response = await fetch(local(`${KP}/logo.png`));
      expect(res.headers.get('etag')).toBeNull();
    });

    it('a missing knowledge path is 200 missing with X-Doc-Writable: true', async () => {
      const res: Response = await fetch(local(`${KP}/not-yet.md`));
      expect(res.status).toBe(200);
      expect(res.headers.get('x-doc-writable')).toBe('true');
      expect(await res.json()).toEqual({
        kind: 'missing',
        path: 'factories.local/local-factory/knowledge/not-yet.md',
      });
    });
  });

  describe('E16 PUT /pipelines/:id/knowledge/<path>', () => {
    it('rewrites a file atomically and answers its bytes and new ETag', async () => {
      const text: string = '# notes v2 — édité\n';
      const res: Response = await put(local(`${KP}/notes.md`), text);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('etag')).toBe(sha(text));
      expect(await res.json()).toEqual({
        kind: 'saved',
        bytes: Buffer.byteLength(text, 'utf8'),
        etag: sha(text),
      });
      expect(await readFile(localFile('notes.md'), 'utf8')).toBe(text);
      const back: Response = await fetch(local(`${KP}/notes.md`));
      expect(back.headers.get('etag')).toBe(sha(text));
      expect(await back.text()).toBe(text);
      const names: string[] = await readdir(localFile());
      expect(names.filter((name: string): boolean => name.endsWith('.tmp'))).toEqual([]);
    });

    it('creates a new file and its folder', async () => {
      const res: Response = await put(local(`${KP}/new/todo.md`), '- [ ] one\n');
      expect(res.status).toBe(200);
      expect(await readFile(localFile('new', 'todo.md'), 'utf8')).toBe('- [ ] one\n');
    });

    it('a .py helper is text and may be fixed', async () => {
      const res: Response = await put(local(`${KP}/helper.py`), 'print(2)\n');
      expect(res.status).toBe(200);
      expect(await readFile(localFile('helper.py'), 'utf8')).toBe('print(2)\n');
    });

    it('If-Match: 409 when stale (file untouched), 200 when current', async () => {
      await writeFile(localFile('guarded.md'), 'one\n', 'utf8');
      const stale: Response = await put(local(`${KP}/guarded.md`), 'two\n', {
        'if-match': sha('zero\n'),
      });
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({
        error: 'the file changed on disk since it was loaded',
      });
      expect(await readFile(localFile('guarded.md'), 'utf8')).toBe('one\n');

      const fresh: Response = await put(local(`${KP}/guarded.md`), 'two\n', {
        'if-match': sha('one\n'),
      });
      expect(fresh.status).toBe(200);
      expect(await readFile(localFile('guarded.md'), 'utf8')).toBe('two\n');
    });

    it('If-Match on a file that is gone is 409', async () => {
      const res: Response = await put(local(`${KP}/gone.md`), 'x', { 'if-match': sha('x') });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: 'the file is gone from disk' });
      await expect(stat(localFile('gone.md'))).rejects.toThrow();
    });

    it('If-None-Match: * is 409 when the file exists, 200 when it does not', async () => {
      const exists: Response = await put(local(`${KP}/helper.py`), 'x', { 'if-none-match': '*' });
      expect(exists.status).toBe(409);
      expect(await exists.json()).toMatchObject({ error: 'the file already exists' });
      const fresh: Response = await put(local(`${KP}/fresh.md`), 'fresh\n', {
        'if-none-match': '*',
      });
      expect(fresh.status).toBe(200);
      expect(await readFile(localFile('fresh.md'), 'utf8')).toBe('fresh\n');
    });

    it('403 for the shared kit, the file untouched', async () => {
      const res: Response = await put(kit(`${FACTORY}/knowledge/method.md`), 'hacked');
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({
        error:
          'the shared kit is read-only in Studio: edit factories/canonical-factory in the repository',
      });
      expect(
        await readFile(
          path.join(work.dir, 'factories/canonical-factory/knowledge/method.md'),
          'utf8',
        ),
      ).toBe('# canonical method\n');
    });

    it.each([
      [`${ROOT}/knowledge/one.md`, 'knowledge/one.md'],
      [`${SKILL}/SKILL.md`, '.claude/skills/local-factory/SKILL.md'],
      ['pipeline.json', 'factories.local/local-factory/pipeline.json'],
      [`${ROOT}/scripts/sync.sh`, 'scripts/sync.sh'],
      [`${KP}/linked/sync.sh`, 'scripts/sync.sh'],
      [`${KP}/linked/new.md`, 'scripts/new.md'],
    ])('403 outside the factory knowledge folder: %s', async (rest: string, onDisk: string) => {
      const before: string | null = await readFile(path.join(work.dir, onDisk), 'utf8').catch(
        (): null => null,
      );
      const res: Response = await put(local(rest), 'hacked');
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: 'outside the factory knowledge folder' });
      const after: string | null = await readFile(path.join(work.dir, onDisk), 'utf8').catch(
        (): null => null,
      );
      expect(after).toBe(before);
    });

    it('403 a linked file cannot be edited, its target untouched', async () => {
      const res: Response = await put(local(`${KP}/escape.md`), 'hacked');
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: 'a linked file cannot be edited' });
      expect(await readFile(path.join(work.dir, 'knowledge/one.md'), 'utf8')).toBe(
        '# One\n\nHello.\n',
      );
    });

    it('415 for an image', async () => {
      const res: Response = await put(local(`${KP}/logo.png`), 'x');
      expect(res.status).toBe(415);
      expect(await res.json()).toMatchObject({ error: 'only text documents can be edited' });
      expect(await readFile(localFile('logo.png'), 'utf8')).toBe('PNG');
    });

    it('400 a folder cannot be written', async () => {
      const res: Response = await put(local(`${KP}/new/`), 'x');
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'a folder cannot be written' });
    });

    it('400 for an encoded traversal', async () => {
      const res: Response = await put(local(`${KP}/..%2F..%2Fpipeline.json`), 'x');
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid path segment' });
    });

    it.each([
      '/api/v1/pipelines/local-factory/knowledge/../../pipeline.json',
      `/api/v1/pipelines/local-factory/knowledge/${KP}/../../pipeline.json`,
      '/api/v1/pipelines/local-factory/knowledge/%2e%2e/%2e%2e/.env',
    ])('refuses the raw traversal %s with 400', async (rawPath: string) => {
      const res: RawResponse = await rawRequest(api.origin, rawPath, 'PUT');
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body)).toMatchObject({ error: 'invalid path segment' });
    });

    it('404 pipeline not found', async () => {
      const res: Response = await put(`${base}/pipelines/no-such-factory/knowledge/x.md`, 'x');
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: 'pipeline not found' });
    });

    it('413 for 3 MB, nothing written', async () => {
      const res: Response = await put(local(`${KP}/big.md`), 'a'.repeat(3 * 1024 * 1024));
      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ error: 'document too large' });
      await expect(stat(localFile('big.md'))).rejects.toThrow();
    });

    it('the legacy fallback writes the file E5 showed, never a twin at the stated place', async () => {
      await writeFile(localFile('old.md'), '# old\n', 'utf8');
      const shown: Response = await fetch(local(`${ROOT}/knowledge/topic/old.md`));
      expect(await shown.text()).toBe('# old\n');
      expect(shown.headers.get('x-doc-writable')).toBe('true');

      const res: Response = await put(local(`${ROOT}/knowledge/topic/old.md`), '# old v2\n', {
        'if-match': sha('# old\n'),
      });
      expect(res.status).toBe(200);
      expect(await readFile(localFile('old.md'), 'utf8')).toBe('# old v2\n');
      await expect(stat(path.join(work.dir, 'knowledge/topic/old.md'))).rejects.toThrow();
    });

    it('sits behind the API key: 401 without it, nothing written', async () => {
      const res: Response = await fetch(
        `${locked.origin}/api/v1/pipelines/local-factory/knowledge/${KP}/locked.md`,
        { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: 'x' },
      );
      expect(res.status).toBe(401);
      await expect(stat(localFile('locked.md'))).rejects.toThrow();
    });
  });
});
