import { readFile, readlink, stat } from 'node:fs/promises';
import path from 'node:path';
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

  const pipelineFile = (id: string): string =>
    path.join(work.dir, 'factories', id, 'pipeline.json');

  const put = (id: string, body: string | Record<string, unknown>): Promise<Response> =>
    fetch(`${base}/pipelines/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
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

  describe('E3 GET /pipelines/:id', () => {
    it('answers the file bytes as application/json with no-store', async () => {
      const res: Response = await fetch(`${base}/pipelines/canonical-factory`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.text()).toBe(await readFile(pipelineFile('canonical-factory'), 'utf8'));
    });
    it.each(['no-such-factory', 'create-any-factory', 'a%2Fb'])(
      '404 pipeline not found for %s',
      async (id: string) => {
        const res: Response = await fetch(`${base}/pipelines/${id}`);
        expect(res.status).toBe(404);
        expect(await res.json()).toMatchObject({ error: 'pipeline not found' });
      },
    );
  });

  describe('E4 PUT /pipelines/:id', () => {
    it('writes the body as received: hooks kept, key order kept, two-space JSON, newline', async () => {
      const sent: Record<string, unknown> = {
        ...CANONICAL_PIPELINE,
        hooks: { after: ['echo changed'] },
        extraTopLevel: [1, 2],
      };
      const text: string = JSON.stringify(sent);
      const res: Response = await put('canonical-factory', text);
      expect(res.status).toBe(200);
      const expected: string = `${JSON.stringify(sent, null, 2)}\n`;
      expect(await res.json()).toEqual({
        kind: 'saved',
        bytes: Buffer.byteLength(expected, 'utf8'),
      });
      expect(await readFile(pipelineFile('canonical-factory'), 'utf8')).toBe(expected);
      const back: Response = await fetch(`${base}/pipelines/canonical-factory`);
      expect(await back.text()).toBe(expected);
    });

    it('400 with the issue on an id that differs from the path', async () => {
      const res: Response = await put('canonical-factory', {
        ...CANONICAL_PIPELINE,
        id: 'other-factory',
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; details: { path: string[] }[] };
      expect(body.error).toBe('invalid request body');
      expect(body.details[0]?.path).toEqual(['id']);
    });

    it('400 with the issues on a body missing steps', async () => {
      const { steps: _steps, ...withoutSteps }: Record<string, unknown> = CANONICAL_PIPELINE;
      const res: Response = await put('canonical-factory', withoutSteps);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { details: { path: (string | number)[] }[] };
      expect(body.details.some((issue): boolean => issue.path[0] === 'steps')).toBe(true);
    });

    it('400 on a step whose prompt or system is the old string form', async () => {
      const { one }: { one: Record<string, unknown> } = CANONICAL_PIPELINE.steps as {
        one: Record<string, unknown>;
      };
      const stringPrompt: Response = await put('canonical-factory', {
        ...CANONICAL_PIPELINE,
        steps: { one: { ...one, prompt: 'do the thing' } },
      });
      expect(stringPrompt.status).toBe(400);
      const stringSystem: Response = await put('canonical-factory', {
        ...CANONICAL_PIPELINE,
        steps: { one: { ...one, system: 'You are a tester.' } },
      });
      expect(stringSystem.status).toBe(400);
      const emptyPrompt: Response = await put('canonical-factory', {
        ...CANONICAL_PIPELINE,
        steps: { one: { ...one, prompt: [] } },
      });
      expect(emptyPrompt.status).toBe(400);
    });

    it('404 on an unknown id and creates no folder', async () => {
      const res: Response = await put('no-such-factory', {
        ...CANONICAL_PIPELINE,
        id: 'no-such-factory',
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: 'pipeline not found' });
      await expect(stat(path.join(work.dir, 'factories', 'no-such-factory'))).rejects.toThrow();
      const sameBody: Response = await put('no-such-factory', CANONICAL_PIPELINE);
      expect(sameBody.status).toBe(404);
    });

    it('413 on a 3 MB body', async () => {
      const res: Response = await put('canonical-factory', {
        ...CANONICAL_PIPELINE,
        pad: 'a'.repeat(3 * 1024 * 1024),
      });
      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ error: 'document too large' });
    });
  });

  describe('E4b POST /pipelines', () => {
    const NEW_PIPELINE: Record<string, unknown> = {
      $schema: '../pipeline.schema.json',
      id: 'fresh-factory',
      description: 'Makes a "fresh" thing\nfast.',
      constants: {
        rootPath: 'cwd',
        skillPath: '.',
        homePath: '~',
        factoryPath: '{{rootPath}}/factories/{{id}}',
      },
      params: {},
      outputDir: '{{rootPath}}/run/{{id}}/{{slug}}-{{date}}',
      START: ['first-step'],
      steps: {
        'first-step': {
          agent: 'general-purpose',
          prompt: ['Do the thing. Return DONE.'],
          knowledge: ['{{factoryPath}}/knowledge/method.md'],
          transitions: { DONE: { target: ['END'] } },
        },
      },
    };

    const post = (body: string | Record<string, unknown>): Promise<Response> =>
      fetch(`${base}/pipelines`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });

    it('201 writes factories/<id>/pipeline.json as received, the wrapper skill in factories-skills and its link', async () => {
      const text: string = JSON.stringify(NEW_PIPELINE);
      const res: Response = await post(text);
      expect(res.status).toBe(201);
      const expected: string = `${JSON.stringify(NEW_PIPELINE, null, 2)}\n`;
      expect(await res.json()).toEqual({
        kind: 'created',
        id: 'fresh-factory',
        path: 'factories/fresh-factory/pipeline.json',
        skill: 'factories-skills/fresh-factory/SKILL.md',
        bytes: Buffer.byteLength(expected, 'utf8'),
      });
      expect(await readFile(pipelineFile('fresh-factory'), 'utf8')).toBe(expected);
      expect(await readlink(path.join(work.dir, '.claude', 'skills', 'fresh-factory'))).toBe(
        '../../factories-skills/fresh-factory',
      );
      const skill: string = await readFile(
        path.join(work.dir, '.claude', 'skills', 'fresh-factory', 'SKILL.md'),
        'utf8',
      );
      expect(skill.startsWith('---\nname: fresh-factory\n')).toBe(true);
      expect(skill).toContain(
        'description: "Makes a \\"fresh\\" thing fast. Only run it when the user invokes it by name, never on your own initiative."',
      );
      expect(skill).toContain(
        'allowed-tools: Read, Write, Glob, Task, AskUserQuestion, Bash, Skill',
      );
      expect(skill).toContain('lives at `factories/fresh-factory/pipeline.json`');
      expect(skill).toContain('    fresh-factory $ARGUMENTS');
      expect(skill).toContain('and follow it with pipeline id `fresh-factory`.');
    });

    it('the new factory is listed, readable, saveable and startable', async () => {
      const list: Response = await fetch(`${base}/pipelines`);
      const body = (await list.json()) as { pipelines: { id: string }[] };
      expect(body.pipelines.map((p): string => p.id)).toContain('fresh-factory');
      const saved: Response = await put('fresh-factory', NEW_PIPELINE);
      expect(saved.status).toBe(200);
      const started: Response = await fetch(`${base}/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'fresh-factory', prompt: 'hello' }),
      });
      expect(started.status).toBe(201);
    });

    it('409 when the factory folder or the wrapper skill is already there', async () => {
      const again: Response = await post(NEW_PIPELINE);
      expect(again.status).toBe(409);
      expect(await again.json()).toMatchObject({
        error: '"fresh-factory" already exists on disk',
        details: { existing: 'factories/fresh-factory/pipeline.json' },
      });
      const unwrapped: Response = await post({ ...NEW_PIPELINE, id: 'unwrapped-factory' });
      expect(unwrapped.status).toBe(409);
      // a wrapper skill without a pipeline is still taken
      const skillOnly: Response = await post({ ...NEW_PIPELINE, id: 'create-any-factory' });
      expect(skillOnly.status).toBe(409);
      expect(await skillOnly.json()).toMatchObject({
        details: { existing: '.claude/skills/create-any-factory/SKILL.md' },
      });
    });

    it('400 without factoryPath or with an anchor that is not its fixed value', async () => {
      const noFactoryPath: Response = await post({
        ...NEW_PIPELINE,
        id: 'another-factory',
        constants: { rootPath: 'cwd', skillPath: '.', homePath: '~' },
      });
      expect(noFactoryPath.status).toBe(400);
      const body = (await noFactoryPath.json()) as { details: { path: (string | number)[] }[] };
      expect(
        body.details.some((issue): boolean => issue.path.join('.') === 'constants.factoryPath'),
      ).toBe(true);
      const badRoot: Response = await post({
        ...NEW_PIPELINE,
        id: 'another-factory',
        constants: { ...(NEW_PIPELINE.constants as object), rootPath: '.' },
      });
      expect(badRoot.status).toBe(400);
      expect(await stat(pipelineFile('another-factory')).catch((): null => null)).toBeNull();
    });

    it('400 on a bad id and on malformed JSON', async () => {
      const badId: Response = await post({ ...NEW_PIPELINE, id: 'Not-An-Id' });
      expect(badId.status).toBe(400);
      const malformed: Response = await post('{ nope');
      expect(malformed.status).toBe(400);
      expect(((await malformed.json()) as { error: string }).error).toMatch(/malformed JSON body/);
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

    it('a pipeline.json that does not parse is still served byte for byte', async () => {
      const res: Response = await fetch(`${base}/pipelines/broken-factory`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('{ not json');
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

    it('404 pipeline not found for a raw .. id', async () => {
      const res: RawResponse = await rawGet(api.origin, '/api/v1/pipelines/%2e%2e');
      expect(res.status).toBe(404);
      expect(JSON.parse(res.body)).toMatchObject({ error: 'pipeline not found' });
    });

    it('404 pipeline not found for an unknown pipeline', async () => {
      const res: Response = await fetch(`${base}/pipelines/no-such-factory/knowledge/SKILL.md`);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: 'pipeline not found' });
    });
  });
});
