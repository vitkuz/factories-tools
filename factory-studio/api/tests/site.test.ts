import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fakeHerdr, type FakeHerdr } from './helpers.js';
import {
  buildTestApp,
  listen,
  makeWorkDir,
  rawGet,
  type Listening,
  type RawResponse,
  type WorkDir,
} from './work-dir.js';

/** The headers every E17 answer carries, whatever it is. No sandbox CSP: a normal page. */
const expectSiteHeaders = (res: Response): void => {
  expect(res.headers.get('content-security-policy')).toBeNull();
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  expect(res.headers.get('cache-control')).toBe('no-store');
};

const bytesOf = async (res: Response): Promise<Buffer> => Buffer.from(await res.arrayBuffer());

describe('site and zip', () => {
  let work: WorkDir;
  let herdr: FakeHerdr;
  let api: Listening;
  let base: string;

  beforeAll(async () => {
    work = await makeWorkDir();
    // A name that needs escaping in the listing page.
    await writeFile(
      path.join(work.dir, 'run/canonical-factory/run-a/5-plain/a<b>&"c".md'),
      'x\n',
      'utf8',
    );
    herdr = fakeHerdr();
    api = await listen(buildTestApp(work, herdr.client));
    base = `${api.origin}/api/v1`;
  });
  afterAll(async () => {
    await api.close();
    await work.cleanup();
  });

  const site = (rest: string): string => `${base}/site/canonical-factory/run-a/${rest}`;
  const zip = (rest: string): string => `${base}/zip/canonical-factory/run-a/${rest}`;

  describe('E17 GET /site/:pipelineId/:runId/*path', () => {
    it("serves a folder's index.html as a page", async () => {
      const res: Response = await fetch(site('4-site/'));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expectSiteHeaders(res);
      expect(res.headers.get('etag')).toBeNull();
      expect(res.headers.get('x-doc-writable')).toBeNull();
      expect(await res.text()).toContain("<script>document.title='x'</script>");
    });

    it('sends a folder named without its / to the folder URL', async () => {
      const res: Response = await fetch(site('4-site'), { redirect: 'manual' });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toMatch(/\/4-site\/$/);
      expect(new URL(res.headers.get('location') ?? '', site('4-site')).href).toBe(site('4-site/'));
      expectSiteHeaders(res);
    });

    it('sends the run root named without its / to the root URL', async () => {
      const res: Response = await fetch(`${base}/site/canonical-factory/run-a`, {
        redirect: 'manual',
      });
      expect(res.status).toBe(302);
      expect(new URL(res.headers.get('location') ?? '', res.url).href).toBe(site(''));
    });

    it('serves each file with the type a browser renders', async () => {
      const css: Response = await fetch(site('4-site/css/site.css'));
      expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8');
      expectSiteHeaders(css);
      const png: Response = await fetch(site('4-site/img/logo.png'));
      expect(png.headers.get('content-type')).toBe('image/png');
      expect(png.headers.get('content-length')).toBe('3');
      const md: Response = await fetch(site('4-site/notes.md'));
      expect(md.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      const json: Response = await fetch(site('5-plain/data.json'));
      expect(json.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(await json.text()).toBe('{"a":1}\n');
    });

    it('lists a folder without index.html: escaped, no dotfiles, no symlinks', async () => {
      const res: Response = await fetch(site('5-plain/'));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expectSiteHeaders(res);
      expect(res.headers.get('etag')).toBeNull();
      const html: string = await res.text();
      expect(html).toContain('href="report.md"');
      expect(html).toContain('href="data.json"');
      expect(html).toContain('href="../"');
      expect(html).not.toContain('escape.md');
      expect(html).not.toContain('linked');
      expect(html).toContain('a&lt;b&gt;&amp;&quot;c&quot;.md');
      expect(html).toContain(`href="${encodeURIComponent('a<b>&"c".md')}"`);
      expect(html).not.toContain('<script');
    });

    it('lists the run root without a ../ link', async () => {
      const html: string = await (await fetch(site(''))).text();
      expect(html).toContain('href="3-write-prd/"');
      expect(html).toContain('href="4-site/"');
      expect(html).toContain('href="5-plain/"');
      expect(html).not.toContain('href="../"');
    });

    it('never serves a dotfile', async () => {
      const res: Response = await fetch(site('4-site/.secret'));
      expect(res.status).toBe(404);
      expectSiteHeaders(res);
    });

    it('refuses a symlink that leads outside the run', async () => {
      const file: Response = await fetch(site('5-plain/escape.md'));
      expect(file.status).toBe(403);
      expect(await file.json()).toMatchObject({ error: 'outside the run folder' });
      expectSiteHeaders(file);
      const folder: Response = await fetch(site('5-plain/linked/sync.sh'));
      expect(folder.status).toBe(403);
    });

    it('refuses traversal and bad escapes', async () => {
      const encoded: RawResponse = await rawGet(
        api.origin,
        '/api/v1/site/canonical-factory/run-a/%2e%2e/run-b/notes.md',
      );
      expect(encoded.status).toBe(400);
      expect(JSON.parse(encoded.body)).toMatchObject({ error: 'invalid path segment' });
      const raw: RawResponse = await rawGet(
        api.origin,
        '/api/v1/site/canonical-factory/run-a/4-site/../../run-b/notes.md',
      );
      expect(raw.status).toBe(400);
      const slash: RawResponse = await rawGet(
        api.origin,
        '/api/v1/site/canonical-factory/run-a/..%2frun-b/notes.md',
      );
      expect(slash.status).toBe(400);
      const bad: RawResponse = await rawGet(api.origin, '/api/v1/site/canonical-factory/run-a/%zz');
      expect(bad.status).toBe(400);
      expect(JSON.parse(bad.body)).toMatchObject({ error: 'bad encoding' });
    });

    it('answers 404 for a file named as a folder, a missing path, an unknown run', async () => {
      const asFolder: Response = await fetch(site('4-site/index.html/'));
      expect(asFolder.status).toBe(404);
      expect(await asFolder.json()).toMatchObject({ error: 'not found' });
      expectSiteHeaders(asFolder);
      expect((await fetch(site('nope/'))).status).toBe(404);
      const run: Response = await fetch(`${base}/site/canonical-factory/no-such-run/x`);
      expect(run.status).toBe(404);
      expect(await run.json()).toMatchObject({ error: 'run not found' });
      expect((await fetch(`${base}/site/a%2Fb/run-a/`)).status).toBe(404);
      expect((await fetch(`${base}/site/canonical-factory/.hidden/`)).status).toBe(404);
    });

    it('answers HEAD with the headers and no body', async () => {
      const res: Response = await fetch(site('4-site/notes.md'), { method: 'HEAD' });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-length')).toBe('8');
      expectSiteHeaders(res);
      expect(await res.text()).toBe('');
    });

    it('leaves E7 as it was: an .html run document is still plain text', async () => {
      const res: Response = await fetch(`${base}/runs/canonical-factory/run-a/4-site/index.html`);
      expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(res.headers.get('content-security-policy')).toBeNull();
    });
  });

  describe('E18 GET /zip/:pipelineId/:runId/*path', () => {
    it('streams a folder as a zip: every file, no dotfiles', async () => {
      const res: Response = await fetch(zip('4-site/'));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/zip');
      expect(res.headers.get('content-disposition')).toBe(
        'attachment; filename="run-a-4-site.zip"',
      );
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body: Buffer = await bytesOf(res);
      expect(body.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
      for (const name of ['index.html', 'css/site.css', 'img/logo.png', 'notes.md']) {
        expect(body.includes(Buffer.from(name))).toBe(true);
      }
      expect(body.includes(Buffer.from('.secret'))).toBe(false);
    });

    it('skips symlinks', async () => {
      const body: Buffer = await bytesOf(await fetch(zip('5-plain/')));
      expect(body.includes(Buffer.from('report.md'))).toBe(true);
      expect(body.includes(Buffer.from('escape.md'))).toBe(false);
      expect(body.includes(Buffer.from('linked'))).toBe(false);
    });

    it('zips the whole run at the root', async () => {
      const res: Response = await fetch(zip(''));
      expect(res.headers.get('content-disposition')).toBe('attachment; filename="run-a.zip"');
      expect((await bytesOf(res)).includes(Buffer.from('3-write-prd/prd.md'))).toBe(true);
    });

    it('refuses a file, a missing folder, traversal and an unknown run', async () => {
      const file: Response = await fetch(zip('4-site/index.html'));
      expect(file.status).toBe(400);
      expect(await file.json()).toMatchObject({ error: 'not a folder' });
      expect((await fetch(zip('nope/'))).status).toBe(404);
      expect((await fetch(zip('5-plain/linked/'))).status).toBe(403);
      const traversal: RawResponse = await rawGet(
        api.origin,
        '/api/v1/zip/canonical-factory/run-a/%2e%2e/',
      );
      expect(traversal.status).toBe(400);
      expect((await fetch(`${base}/zip/canonical-factory/no-such-run/`)).status).toBe(404);
    });

    it('answers HEAD with the headers and no body', async () => {
      const res: Response = await fetch(zip('4-site/'), { method: 'HEAD' });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/zip');
      expect(await res.text()).toBe('');
    });
  });

  describe('limits', () => {
    it('refuses a folder past the entry or byte cap before streaming', async () => {
      const byEntries: Listening = await listen(
        buildTestApp(work, fakeHerdr().client, { zipLimits: { maxEntries: 2, maxBytes: 1e9 } }),
      );
      const bytes: Listening = await listen(
        buildTestApp(work, fakeHerdr().client, { zipLimits: { maxEntries: 1e6, maxBytes: 1 } }),
      );
      try {
        const res: Response = await fetch(
          `${byEntries.origin}/api/v1/zip/canonical-factory/run-a/4-site/`,
        );
        expect(res.status).toBe(413);
        const body: { error: string; details: { maxEntries: number } } = (await res.json()) as {
          error: string;
          details: { maxEntries: number };
        };
        expect(body.error).toBe('folder too large to zip');
        expect(body.details.maxEntries).toBe(2);
        expect(
          (await fetch(`${bytes.origin}/api/v1/zip/canonical-factory/run-a/4-site/`)).status,
        ).toBe(413);
      } finally {
        await byEntries.close();
        await bytes.close();
      }
    });
  });

  describe('the API key', () => {
    it('applies to E17 and E18 like every /api/v1 route', async () => {
      const key: string = 'k'.repeat(16);
      const locked: Listening = await listen(
        buildTestApp(work, fakeHerdr().client, { apiKey: key }),
      );
      try {
        const url: string = `${locked.origin}/api/v1/site/canonical-factory/run-a/4-site/`;
        expect((await fetch(url)).status).toBe(401);
        expect((await fetch(url, { headers: { 'x-api-key': key } })).status).toBe(200);
        const zipUrl: string = `${locked.origin}/api/v1/zip/canonical-factory/run-a/4-site/`;
        expect((await fetch(zipUrl)).status).toBe(401);
      } finally {
        await locked.close();
      }
    });
  });

  describe('what a page on another site can send', () => {
    it('cannot start a session with a text/plain POST: the body is never parsed', async () => {
      const res: Response = await fetch(`${base}/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain', origin: 'null' },
        body: '{"id":"canonical-factory","prompt":"x"}',
      });
      expect(res.status).toBe(400);
      expect(herdr.workspaces).toEqual([]);
    });
  });
});
