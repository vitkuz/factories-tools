import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fakeTmux } from './helpers.js';
import {
  CANONICAL_PIPELINE,
  buildTestApp,
  listen,
  makeWorkDir,
  rawGet,
  type Listening,
  type RawResponse,
  type WorkDir,
} from './work-dir.js';

describe('pipelines', () => {
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

  describe('E2 GET /pipelines', () => {
    it('lists the skills with a parseable pipeline.json, sorted, nothing else', async () => {
      const res: Response = await fetch(`${base}/pipelines`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = (await res.json()) as {
        pipelines: { id: string; path: string; pipeline: { id: string } }[];
      };
      expect(body.pipelines.map((p): string => p.id)).toEqual([
        'canonical-factory',
        'local-factory',
        'other-factory',
        'unwrapped-factory',
      ]);
      expect(body.pipelines[1]).toMatchObject({
        id: 'local-factory',
        path: 'factories.local/local-factory/pipeline.json',
      });
      expect(body.pipelines[0]).toMatchObject({
        id: 'canonical-factory',
        path: 'factories/canonical-factory/pipeline.json',
        pipeline: { id: 'canonical-factory', hooks: CANONICAL_PIPELINE.hooks },
      });
    });
  });

  describe('read-only: no pipeline read, save or create routes', () => {
    it.each([
      ['GET', '/pipelines/canonical-factory'],
      ['PUT', '/pipelines/canonical-factory'],
      ['POST', '/pipelines'],
    ])('%s %s is a JSON 404', async (method: string, route: string) => {
      const res: Response = await fetch(`${base}${route}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify(CANONICAL_PIPELINE),
      });
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toMatch(/application\/json/);
    });
  });

  describe('E5 GET /pipelines/:id/knowledge/<path>', () => {
    const knowledge = (rest: string): string =>
      `${base}/pipelines/canonical-factory/knowledge/${rest}`;

    it('a {{rootPath}} markdown file as text/markdown with its length', async () => {
      const res: Response = await fetch(knowledge('%7B%7BrootPath%7D%7D/knowledge/one.md'));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('content-length')).toBe(
        String(Buffer.byteLength('# One\n\nHello.\n')),
      );
      expect(await res.text()).toBe('# One\n\nHello.\n');
    });

    it('HEAD answers the headers and no body', async () => {
      const res: Response = await fetch(knowledge('%7B%7BrootPath%7D%7D/knowledge/one.md'), {
        method: 'HEAD',
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
      expect(await res.text()).toBe('');
    });

    it('a {{factoryPath}} file resolves inside factories/<id>', async () => {
      const res: Response = await fetch(knowledge('%7B%7BfactoryPath%7D%7D/knowledge/method.md'));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('# canonical method\n');
    });

    it('a {{skillPath}} file resolves inside the wrapper skill .claude/skills/<id>', async () => {
      const res: Response = await fetch(knowledge('%7B%7BskillPath%7D%7D/SKILL.md'));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('# canonical-factory\n');
    });

    it('a bare path resolves against the folder holding pipeline.json', async () => {
      const res: Response = await fetch(knowledge('DESIGN.md'));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('# canonical design\n');
    });

    it('a path the pipeline names but that is not on disk is 200 missing', async () => {
      const res: Response = await fetch(
        knowledge('%7B%7BrootPath%7D%7D/knowledge/agents/missing.md'),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ kind: 'missing', path: 'knowledge/agents/missing.md' });
    });

    describe('a path from before the factory layout falls back to factories/<id>/knowledge', () => {
      it('by its sub-path: {{rootPath}}/knowledge/frameworks/x.md', async () => {
        const res: Response = await fetch(
          knowledge('%7B%7BrootPath%7D%7D/knowledge/frameworks/mece.md'),
        );
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
        expect(await res.text()).toBe('# MECE\n');
      });

      it('by its name when the old sub-folder is gone: {{rootPath}}/knowledge/<topic>/x.md', async () => {
        const res: Response = await fetch(
          knowledge('%7B%7BrootPath%7D%7D/knowledge/research/mandatory-output-style.md'),
        );
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('# Output style\n');
      });

      it('from the old skill folder: {{skillPath}}/knowledge/x.md', async () => {
        const res: Response = await fetch(
          knowledge('%7B%7BskillPath%7D%7D/knowledge/frameworks/mece.md'),
        );
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('# MECE\n');
      });

      it('a file at its stated place wins over a namesake in the factory knowledge', async () => {
        const res: Response = await fetch(knowledge('%7B%7BrootPath%7D%7D/knowledge/one.md'));
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('# One\n\nHello.\n');
      });

      it('a folder is never looked up elsewhere', async () => {
        const res: Response = await fetch(knowledge('%7B%7BrootPath%7D%7D/knowledge/frameworks/'));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ kind: 'missing', path: 'knowledge/frameworks/' });
      });
    });

    it('a folder lists folders first, dotfiles hidden', async () => {
      const res: Response = await fetch(knowledge('%7B%7BrootPath%7D%7D/knowledge/'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        kind: 'directory',
        path: 'knowledge/',
        entries: [
          { name: 'coding', type: 'directory', size: 0 },
          { name: 'one.md', type: 'file', size: Buffer.byteLength('# One\n\nHello.\n') },
        ],
      });
    });

    it('a file named with a trailing slash is 404 not found', async () => {
      const res: Response = await fetch(knowledge('%7B%7BrootPath%7D%7D/knowledge/one.md/'));
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: 'not found' });
    });

    it.each([
      ['%7B%7BrootPath%7D%7D/..%2F..%2F.env', 400, 'invalid path segment'],
      ['..%2F..%2F.env', 400, 'invalid path segment'],
      ['%ZZ', 400, 'bad encoding'],
      ['%7B%7BrootPath%7D%7D/', 400, 'empty path'],
    ])('refuses %s with %d %s', async (rest: string, status: number, error: string) => {
      const res: Response = await fetch(knowledge(rest));
      expect(res.status).toBe(status);
      expect(await res.json()).toMatchObject({ error });
    });

    it.each([
      '/api/v1/pipelines/canonical-factory/knowledge/../../.env',
      '/api/v1/pipelines/canonical-factory/knowledge/%7B%7BrootPath%7D%7D/../../.env',
      '/api/v1/pipelines/canonical-factory/knowledge/%2e%2e/%2e%2e/.env',
      '/api/v1/pipelines/canonical-factory/knowledge/./SKILL.md',
    ])('refuses the raw traversal %s with 400 and never a file', async (rawPath: string) => {
      const res: RawResponse = await rawGet(api.origin, rawPath);
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body)).toMatchObject({ error: 'invalid path segment' });
    });

    it('404 pipeline not found for an unknown pipeline', async () => {
      const res: Response = await fetch(`${base}/pipelines/no-such-factory/knowledge/SKILL.md`);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: 'pipeline not found' });
    });
  });
});
