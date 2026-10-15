import path from 'node:path';

/** The one folder the scripts route reads: the repository's hook scripts. */
export const SCRIPTS_DIR = 'scripts';

/** A hook script is a short text file; 1 MB is far past any of them. */
export const MAX_SCRIPT_BYTES: number = 1024 * 1024;

/** Only what the app can show as text leaves the server: never an image or opaque bytes. Pure. */
export const isTextContentType = (contentType: string): boolean =>
  contentType.startsWith('text/') || contentType.startsWith('application/json');

/** `file` is strictly inside `base` (both already real paths): never the base itself, never above it. Pure. */
export const isWithin = (base: string, file: string): boolean => {
  const rel: string = path.relative(base, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};
