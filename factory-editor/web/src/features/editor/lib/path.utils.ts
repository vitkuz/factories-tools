/**
 * Reading a doc path on screen. A step names a file two ways: an `input`/`output` path
 * relative to the run folder, and a `knowledge` path carrying a `{{rootPath}}`,
 * `{{factoryPath}}` or `{{skillPath}}` template. On a card the template is noise — the path
 * under it is what a person recognises — so it is stripped for display and kept for the fetch.
 */

/** Split a path into segments that keep their trailing `/` (the break points). */
export const pathSegments = (path: string): string[] => {
  const segments: string[] = path.match(/[^/]*\/|[^/]+$/g) ?? [];
  return segments.length > 0 ? segments : [path];
};

/**
 * The basename is the last segment — `ticket.md` for a file, `screenshots/` for a folder
 * entry — so a folder and a file inside it never look alike.
 */
export const pathBasename = (path: string): string => {
  const segments: string[] = pathSegments(path);
  return segments[segments.length - 1] ?? path;
};

/** A path split at the basename boundary: the directory is dimmed, the name carries the ink. */
export interface SplitPath {
  dir: string;
  base: string;
}

export const splitPath = (path: string): SplitPath => {
  const base: string = pathBasename(path);
  return { dir: path.slice(0, path.length - base.length), base };
};

/**
 * A doc path as people should read it: `{{factoryPath}}/`, `{{skillPath}}/` and
 * `{{rootPath}}/` are how the harness resolves a knowledge file (the factory folder, the
 * wrapper skill folder, the harness root); on screen the
 * path under that location is enough, and the template stays in the `title`.
 */
export const displayDocPath = (path: string): string =>
  path.replace(/^\{\{(skillPath|rootPath|factoryPath)\}\}\/+/, '');
