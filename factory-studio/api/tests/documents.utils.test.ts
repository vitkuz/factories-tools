import { describe, expect, it } from 'vitest';
import {
  MAX_DOCUMENT_BYTES,
  contentTypeFor,
  docPathOf,
  etagOf,
  isEditableFile,
  isHashable,
  isWithin,
  isRecorderFile,
  parseDocPath,
  resolveDocPath,
  sortEntries,
  writeGuardOf,
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

describe('etagOf', () => {
  it('is the quoted sha256 of the UTF-8 bytes', () => {
    expect(etagOf('')).toBe('"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"');
    expect(etagOf('a')).not.toBe(etagOf('b'));
    expect(etagOf('é')).toBe(etagOf('é'));
  });
});

describe('writeGuardOf', () => {
  it.each([
    [undefined, undefined, { kind: 'any' }],
    ['', undefined, { kind: 'any' }],
    ['  ', '', { kind: 'any' }],
    ['"abc"', undefined, { kind: 'match', etag: '"abc"' }],
    [' "abc" ', undefined, { kind: 'match', etag: '"abc"' }],
    [undefined, '*', { kind: 'absent' }],
    ['"abc"', ' * ', { kind: 'absent' }],
    [undefined, '"abc"', { kind: 'any' }],
  ])('If-Match %j, If-None-Match %j → %j', (ifMatch, ifNoneMatch, guard) => {
    expect(writeGuardOf(ifMatch, ifNoneMatch)).toEqual(guard);
  });
});

describe('isHashable', () => {
  it('a text file within the PUT limit, nothing else', () => {
    expect(isHashable('a.md', 10)).toBe(true);
    expect(isHashable('a.py', MAX_DOCUMENT_BYTES)).toBe(true);
    expect(isHashable('a.md', MAX_DOCUMENT_BYTES + 1)).toBe(false);
    expect(isHashable('a.png', 10)).toBe(false);
    expect(isHashable('a.pyc', 10)).toBe(false);
  });
});

describe('isWithin', () => {
  it('strictly inside, never the base itself or a sibling with the same prefix', () => {
    expect(isWithin('/a/knowledge', '/a/knowledge/x.md')).toBe(true);
    expect(isWithin('/a/knowledge', '/a/knowledge')).toBe(false);
    expect(isWithin('/a/knowledge', '/a/knowledge-2/x.md')).toBe(false);
    expect(isWithin('/a/knowledge', '/a/x.md')).toBe(false);
  });
});
