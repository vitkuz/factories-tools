import { describe, expect, it } from 'vitest';
import {
  SITE_HEADERS,
  escapeHtml,
  formatSize,
  renderListing,
  sanitiseFileName,
  siteContentTypeFor,
  zipFileName,
} from '../src/features/site/index.js';

describe('siteContentTypeFor', () => {
  it.each([
    ['index.html', 'text/html; charset=utf-8'],
    ['page.HTM', 'text/html; charset=utf-8'],
    ['a/site.css', 'text/css; charset=utf-8'],
    ['app.js', 'text/javascript; charset=utf-8'],
    ['mod.mjs', 'text/javascript; charset=utf-8'],
    ['data.json', 'application/json; charset=utf-8'],
    ['notes.md', 'text/plain; charset=utf-8'],
    ['log.txt', 'text/plain; charset=utf-8'],
    ['rows.csv', 'text/plain; charset=utf-8'],
    ['run.py', 'text/plain; charset=utf-8'],
    ['logo.png', 'image/png'],
    ['icon.svg', 'image/svg+xml'],
    ['doc.pdf', 'application/pdf'],
    ['font.woff2', 'font/woff2'],
    ['clip.mp4', 'video/mp4'],
    ['blob.bin', 'application/octet-stream'],
    ['Makefile', 'application/octet-stream'],
  ])('%s -> %s', (file: string, type: string) => {
    expect(siteContentTypeFor(file)).toBe(type);
  });
});

describe('SITE_HEADERS', () => {
  it('sends no sandbox CSP and forbids sniffing', () => {
    expect(SITE_HEADERS['Content-Security-Policy']).toBeUndefined();
    expect(SITE_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(SITE_HEADERS['Referrer-Policy']).toBe('no-referrer');
  });
});

describe('escapeHtml', () => {
  it('escapes the five characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});

describe('formatSize', () => {
  it.each([
    [0, '0 B'],
    [999, '999 B'],
    [1200, '1.2 kB'],
    [3_400_000, '3.4 MB'],
  ])('%d -> %s', (bytes: number, text: string) => {
    expect(formatSize(bytes)).toBe(text);
  });
});

describe('renderListing', () => {
  it('links folders with a trailing /, escapes names and adds ../ below the root', () => {
    const html: string = renderListing({
      runLabel: 'p/r',
      path: 'step/',
      entries: [
        { name: 'sub dir', type: 'directory', size: 0 },
        { name: '<x>.md', type: 'file', size: 1200 },
      ],
    });
    expect(html).toContain('<title>p/r/step/</title>');
    expect(html).toContain('<li><a href="../">../</a></li>');
    expect(html).toContain('<a href="sub%20dir/">sub dir/</a>');
    expect(html).toContain('<a href="%3Cx%3E.md">&lt;x&gt;.md</a>');
    expect(html).toContain('1.2 kB');
    expect(html).not.toContain('<script');
  });

  it('has no ../ at the run root and says when a folder is empty', () => {
    const html: string = renderListing({ runLabel: 'p/r', path: '', entries: [] });
    expect(html).not.toContain('href="../"');
    expect(html).toContain('empty folder');
  });
});

describe('zip names', () => {
  it('keeps only [A-Za-z0-9._-] and is never empty', () => {
    expect(sanitiseFileName('run-a-1 get "lead"')).toBe('run-a-1-get-lead');
    expect(sanitiseFileName('../..')).toBe('download');
    expect(sanitiseFileName('отчёт')).toBe('download');
  });

  it('names the zip after the run and the folder', () => {
    expect(zipFileName('run-a', ['4-site'])).toBe('run-a-4-site.zip');
    expect(zipFileName('run-a', ['a', 'b c'])).toBe('run-a-b-c.zip');
    expect(zipFileName('run-a', [])).toBe('run-a.zip');
  });
});
