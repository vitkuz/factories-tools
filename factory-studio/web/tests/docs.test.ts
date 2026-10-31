import { describe, expect, it } from 'vitest';
import { savedSchema } from '../src/shared/document-viewer/docs.schema';
import type { DocContent, DocVersion, SaveGuard } from '../src/shared/document-viewer/docs.types';
import {
  docVersionOf,
  guardHeaders,
  isWritableDoc,
  saveGuardFor,
} from '../src/shared/document-viewer/docs.utils';

const ETAG = '"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"';

describe('docVersionOf', () => {
  it.each([
    [
      { etag: ETAG, 'x-doc-writable': 'true' },
      { etag: ETAG, writable: true },
    ],
    [
      { etag: ETAG, 'x-doc-writable': 'false' },
      { etag: ETAG, writable: false },
    ],
    [{ etag: ETAG }, { etag: ETAG }],
    [{ 'x-doc-writable': 'true' }, { writable: true }],
    [{}, {}],
    [{ etag: '', 'x-doc-writable': 7 }, {}],
  ])('%j → %j', (headers: Record<string, unknown>, version: DocVersion) => {
    expect(docVersionOf(headers)).toEqual(version);
  });
});

describe('saveGuardFor', () => {
  it.each<[DocContent, SaveGuard]>([
    [
      { kind: 'markdown', text: 'x', etag: ETAG },
      { kind: 'match', etag: ETAG },
    ],
    [
      { kind: 'text', text: 'x', etag: ETAG },
      { kind: 'match', etag: ETAG },
    ],
    [{ kind: 'text', text: 'x' }, { kind: 'any' }],
    [{ kind: 'missing' }, { kind: 'absent' }],
    [{ kind: 'missing', writable: true }, { kind: 'absent' }],
    [{ kind: 'binary' }, { kind: 'any' }],
  ])('%j → %j', (content: DocContent, guard: SaveGuard) => {
    expect(saveGuardFor(content)).toEqual(guard);
  });
});

describe('isWritableDoc', () => {
  it('a run doc the opener granted, and nothing the opener did not', () => {
    expect(isWritableDoc(true, { kind: 'markdown', text: 'x', etag: ETAG })).toBe(true);
    expect(isWritableDoc(true, { kind: 'missing' })).toBe(true);
    expect(isWritableDoc(false, { kind: 'markdown', text: 'x', etag: ETAG })).toBe(false);
  });
  it('a knowledge file the API calls writable, with no grant needed', () => {
    expect(isWritableDoc(false, { kind: 'markdown', text: 'x', writable: true })).toBe(true);
    expect(isWritableDoc(false, { kind: 'text', text: 'x', writable: true })).toBe(true);
    expect(isWritableDoc(false, { kind: 'missing', writable: true })).toBe(true);
  });
  it('writable: false wins over the grant', () => {
    expect(isWritableDoc(true, { kind: 'markdown', text: 'x', writable: false })).toBe(false);
    expect(isWritableDoc(true, { kind: 'missing', writable: false })).toBe(false);
  });
  it.each<DocContent>([
    { kind: 'directory', path: 'x/', entries: [] },
    { kind: 'image', url: '/x.png' },
    { kind: 'binary' },
    { kind: 'unavailable' },
    { kind: 'error', message: 'x' },
  ])('never %j', (content: DocContent) => {
    expect(isWritableDoc(true, content)).toBe(false);
  });
});

describe('guardHeaders', () => {
  it.each<[SaveGuard, Record<string, string>]>([
    [{ kind: 'any' }, {}],
    [{ kind: 'match', etag: ETAG }, { 'If-Match': ETAG }],
    [{ kind: 'absent' }, { 'If-None-Match': '*' }],
  ])('%j → %j', (guard: SaveGuard, headers: Record<string, string>) => {
    expect(guardHeaders(guard)).toEqual(headers);
  });
});

describe('savedSchema', () => {
  it('takes the etag, and an answer without one (an older API)', () => {
    expect(savedSchema.parse({ kind: 'saved', bytes: 3, etag: ETAG })).toEqual({
      kind: 'saved',
      bytes: 3,
      etag: ETAG,
    });
    expect(savedSchema.parse({ kind: 'saved', bytes: 3 })).toEqual({ kind: 'saved', bytes: 3 });
  });
});
