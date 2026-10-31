import type { Readable } from 'node:stream';

export interface ParsedDocPath {
  segments: string[];
  /** The raw path ended in `/`: the caller means a folder. */
  directory: boolean;
}

export type DocPathError = 'empty path' | 'bad encoding' | 'invalid path segment';

export type ParseDocPathResult =
  { ok: true; parsed: ParsedDocPath } | { ok: false; status: 400; error: DocPathError };

export type ResolveDocPathResult =
  { ok: true; file: string } | { ok: false; status: 403; error: 'outside the document root' };

export interface DirEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
}

/** A version of a file's bytes: the strong ETag E5/E7 answer and E8/E16 check, `"<sha256 hex>"`. */
export type DocEtag = string;

export type DocumentAnswer =
  | {
      kind: 'file';
      file: string;
      size: number;
      contentType: string;
      open: () => Readable;
      /** Set for an editable text file of at most `MAX_DOCUMENT_BYTES`; absent otherwise. */
      etag?: DocEtag;
      /** Knowledge docs only: may the person rewrite this file through the API? */
      writable?: boolean;
    }
  | { kind: 'directory'; path: string; entries: DirEntry[] }
  | { kind: 'missing'; path: string; writable?: boolean }
  /** A path that ends in `/` but names a file, or something neither file nor folder. */
  | { kind: 'not-found' }
  | { kind: 'refused'; status: 400 | 403 | 413 | 415; error: string };

/** What the caller expects to find on disk before a write goes through. */
export type WriteGuard = { kind: 'any' } | { kind: 'match'; etag: DocEtag } | { kind: 'absent' };

export type WriteAnswer =
  | { kind: 'saved'; bytes: number; etag: DocEtag }
  | { kind: 'refused'; status: 400 | 403 | 409 | 415; error: string };
