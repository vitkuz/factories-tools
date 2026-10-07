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

export type DocumentAnswer =
  | { kind: 'file'; file: string; size: number; contentType: string; open: () => Readable }
  | { kind: 'directory'; path: string; entries: DirEntry[] }
  | { kind: 'missing'; path: string }
  /** A path that ends in `/` but names a file, or something neither file nor folder. */
  | { kind: 'not-found' }
  | { kind: 'refused'; status: 400 | 403 | 413 | 415; error: string };

export type WriteAnswer =
  { kind: 'saved'; bytes: number } | { kind: 'refused'; status: 400 | 403 | 415; error: string };
