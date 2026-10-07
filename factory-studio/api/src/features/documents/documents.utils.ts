import path from 'node:path';
import type {
  DirEntry,
  ParseDocPathResult,
  ParsedDocPath,
  ResolveDocPathResult,
} from './documents.types.js';

/** A saved document is a hand-written text file, not an upload: 2 MB is far past any of them. */
export const MAX_DOCUMENT_BYTES: number = 2 * 1024 * 1024;

/**
 * Files the run recorder owns: `state.json` is written by the running factory and `cost.json`
 * by ai-usage (BR33). A document PUT never overwrites either, at any depth.
 */
export const RECORDER_FILES: readonly string[] = ['state.json', 'cost.json'];

/** Does the last segment name a recorder file? Pure. */
export const isRecorderFile = (segments: readonly string[]): boolean =>
  segments.length > 0 && RECORDER_FILES.includes(segments[segments.length - 1] ?? '');

/** One segment of a document path, already decoded. `.`, `..`, empty and separators are out. */
export const isSafeSegment = (segment: string): boolean =>
  segment !== '' &&
  segment !== '.' &&
  segment !== '..' &&
  !segment.includes('/') &&
  !segment.includes('\\');

const decodeSegment = (part: string): string | null => {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
};

/**
 * Split and check a URL doc path: every segment is URL-decoded; `..`, `.`, an empty segment
 * or a separator inside a segment are refused. A trailing `/` marks a folder. Pure.
 */
export const parseDocPath = (raw: string): ParseDocPathResult => {
  if (raw === '') return { ok: false, status: 400, error: 'empty path' };
  const directory: boolean = raw.endsWith('/');
  const parts: string[] = directory ? raw.split('/').slice(0, -1) : raw.split('/');
  const decoded: (string | null)[] = parts.map(decodeSegment);
  if (decoded.some((segment: string | null): boolean => segment === null)) {
    return { ok: false, status: 400, error: 'bad encoding' };
  }
  const segments: string[] = decoded.filter(
    (segment: string | null): segment is string => typeof segment === 'string',
  );
  if (segments.some((segment: string): boolean => !isSafeSegment(segment))) {
    return { ok: false, status: 400, error: 'invalid path segment' };
  }
  if (segments.length === 0) return { ok: false, status: 400, error: 'empty path' };
  return { ok: true, parsed: { segments, directory } };
};

/** Resolve checked segments under `base` and confirm the result stays inside it. Pure. */
export const resolveDocPath = (base: string, segments: readonly string[]): ResolveDocPathResult => {
  const resolved: string = path.resolve(base, ...segments);
  const rel: string = path.relative(base, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, status: 403, error: 'outside the document root' };
  }
  return { ok: true, file: resolved };
};

export const MIME: Readonly<Record<string, string>> = {
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.csv': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  /** JSON Lines is one JSON value per line, so it is text to a reader, never one JSON document. */
  '.jsonl': 'text/plain; charset=utf-8',
  '.html': 'text/plain; charset=utf-8',
  '.js': 'text/plain; charset=utf-8',
  '.mjs': 'text/plain; charset=utf-8',
  '.cjs': 'text/plain; charset=utf-8',
  '.jsx': 'text/plain; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.tsx': 'text/plain; charset=utf-8',
  '.sh': 'text/plain; charset=utf-8',
  '.bash': 'text/plain; charset=utf-8',
  '.py': 'text/plain; charset=utf-8',
  '.css': 'text/plain; charset=utf-8',
  '.yml': 'text/plain; charset=utf-8',
  '.yaml': 'text/plain; charset=utf-8',
  '.toml': 'text/plain; charset=utf-8',
  '.xml': 'text/plain; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
};

/** Content type by extension; unknown files are opaque bytes. */
export const contentTypeFor = (file: string): string =>
  MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

/** Only files the app can show as text are editable: never an image or an opaque blob. */
export const isEditableFile = (file: string): boolean => {
  const type: string = contentTypeFor(file);
  return type.startsWith('text/') || type.startsWith('application/json');
};

/** The checked path as the answers report it: segments joined, trailing `/` for a folder. */
export const docPathOf = (parsed: ParsedDocPath): string =>
  parsed.segments.join('/') + (parsed.directory ? '/' : '');

/** Folders first, then by name. Returns a new array. */
export const sortEntries = (entries: readonly DirEntry[]): DirEntry[] =>
  [...entries].sort((a: DirEntry, b: DirEntry): number =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1,
  );
