import { describe, expect, it } from 'vitest';
import {
  contentTypeFor,
  docPathOf,
  isEditableFile,
  isRecorderFile,
  parseDocPath,
  resolveDocPath,
  sortEntries,
} from '../src/features/documents/documents.utils.js';

describe('parseDocPath', () => {
  it.each([
    ['', 'empty path'],
    ['/', 'invalid path segment'],
    ['.', 'invalid path segment'],
    ['..', 'invalid path segment'],
    ['a/../b', 'invalid path segment'],
    ['a//b', 'invalid path segment'],
    ['a%2Fb', 'invalid path segment'],
    ['a%5Cb', 'invalid path segment'],
    ['%2e%2e/x', 'invalid path segment'],
    ['%ZZ', 'bad encoding'],
  ])('refuses %j with %s', (raw: string, error: string) => {
    const result = parseDocPath(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toBe(error);
  });

  it('decodes segments once and keeps a trailing slash as a folder', () => {
    expect(parseDocPath('%7B%7BrootPath%7D%7D/knowledge/one.md')).toEqual({
      ok: true,
      parsed: { segments: ['{{rootPath}}', 'knowledge', 'one.md'], directory: false },
    });
    expect(parseDocPath('knowledge/')).toEqual({
      ok: true,
      parsed: { segments: ['knowledge'], directory: true },
    });
  });
});

describe('resolveDocPath', () => {
  it('stays inside the base', () => {
    expect(resolveDocPath('/base', ['a', 'b.md'])).toEqual({ ok: true, file: '/base/a/b.md' });
  });
  it('refuses the base itself and anything that escapes it', () => {
    expect(resolveDocPath('/base', [])).toMatchObject({ ok: false, status: 403 });
    expect(resolveDocPath('/base', ['..', 'x'])).toMatchObject({
      ok: false,
      status: 403,
      error: 'outside the document root',
    });
    expect(resolveDocPath('/base', ['/etc/passwd'])).toMatchObject({ ok: false, status: 403 });
  });
});

describe('contentTypeFor', () => {
  it.each([
    ['a.md', 'text/markdown; charset=utf-8'],
    ['a.MARKDOWN', 'text/markdown; charset=utf-8'],
    ['a.json', 'application/json; charset=utf-8'],
    ['a.ts', 'text/plain; charset=utf-8'],
    ['a.html', 'text/plain; charset=utf-8'],
    ['a.png', 'image/png'],
    ['a.svg', 'image/svg+xml'],
    ['a.bin', 'application/octet-stream'],
    ['noext', 'application/octet-stream'],
  ])('%s -> %s', (file: string, type: string) => {
    expect(contentTypeFor(file)).toBe(type);
  });
});

describe('isEditableFile', () => {
  it('allows text and json, refuses images and blobs', () => {
    expect(isEditableFile('x.md')).toBe(true);
    expect(isEditableFile('x.json')).toBe(true);
    expect(isEditableFile('x.png')).toBe(false);
    expect(isEditableFile('x.bin')).toBe(false);
  });
});

describe('isRecorderFile', () => {
  it('names state.json and cost.json by their last segment, at any depth', () => {
    expect(isRecorderFile(['state.json'])).toBe(true);
    expect(isRecorderFile(['cost.json'])).toBe(true);
    expect(isRecorderFile(['3-write-prd', 'state.json'])).toBe(true);
    expect(isRecorderFile(['state.json', 'notes.md'])).toBe(false);
    expect(isRecorderFile(['pipeline.json'])).toBe(false);
    expect(isRecorderFile(['my-state.json'])).toBe(false);
    expect(isRecorderFile([])).toBe(false);
  });
});

describe('docPathOf and sortEntries', () => {
  it('joins segments and marks a folder', () => {
    expect(docPathOf({ segments: ['a', 'b'], directory: true })).toBe('a/b/');
    expect(docPathOf({ segments: ['a'], directory: false })).toBe('a');
  });
  it('puts folders first, then names, without mutating', () => {
    const input = [
      { name: 'z.md', type: 'file' as const, size: 1 },
      { name: 'b', type: 'directory' as const, size: 0 },
      { name: 'a.md', type: 'file' as const, size: 2 },
    ];
    const sorted = sortEntries(input);
    expect(sorted.map((e): string => e.name)).toEqual(['b', 'a.md', 'z.md']);
    expect(input[0]?.name).toBe('z.md');
  });
});
