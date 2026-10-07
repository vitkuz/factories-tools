// Copied verbatim from factories-tools/factory-studio/web/src/shared/graph/text.ts — do not edit here.
// tests/studio-sync.test.ts fails when the two drift: change the Studio file and copy it again
// (the only edits the copy script makes are the `.js` import extensions this ESM build needs).

/**
 * Deterministic wrapping for monospace paths on step cards. IBM Plex Mono is exactly
 * 0.6 em wide per glyph, so a fixed column width gives a fixed number of characters per
 * line — the card height can be computed before anything is measured.
 */

/** Split a path into segments that keep their trailing `/` (the allowed break points). */
export const pathSegments = (path: string): string[] => {
  const segments: string[] = path.match(/[^/]*\/|[^/]+$/g) ?? [];
  return segments.length > 0 ? segments : [path];
};

/**
 * Greedy line breaking: break after `/` when a segment does not fit, and break inside a
 * segment only when it is longer than a line (what `overflow-wrap: anywhere` does).
 * Lines after the first are one column shorter — the card indents them by 1 ch so a
 * continuation never reads as a new entry.
 */
export const wrapPath = (path: string, cols: number): string[] => {
  const lines: string[] = [];
  let line: string = '';
  const room = (): number => (lines.length === 0 ? cols : cols - 1);
  for (const seg of pathSegments(path)) {
    if (line.length + seg.length <= room()) {
      line += seg;
      continue;
    }
    if (line.length > 0) lines.push(line);
    let rest: string = seg;
    while (rest.length > room()) {
      lines.push(rest.slice(0, room()));
      rest = rest.slice(room());
    }
    line = rest;
  }
  if (line.length > 0 || lines.length === 0) lines.push(line);
  return lines;
};

/** One rendered line of a path: the directory part (dimmed) and the part of the basename on it. */
export interface PathLine {
  dir: string;
  base: string;
}

/**
 * The basename is the last segment — `index.md` for a file, `screenshots/` for a folder
 * entry — so a folder and a file inside it never look alike.
 */
export const pathBasename = (path: string): string => {
  const segments: string[] = pathSegments(path);
  return segments[segments.length - 1] ?? path;
};

/** `wrapPath` lines split at the basename boundary, for two-tone rendering. */
export const splitPathLines = (path: string, cols: number): PathLine[] => {
  const dirLength: number = path.length - pathBasename(path).length;
  let offset: number = 0;
  return wrapPath(path, cols).map((line: string): PathLine => {
    const dirChars: number = Math.max(0, Math.min(line.length, dirLength - offset));
    offset += line.length;
    return { dir: line.slice(0, dirChars), base: line.slice(dirChars) };
  });
};

export const wrappedLineCount = (paths: readonly string[], cols: number): number =>
  paths.reduce((n: number, p: string): number => n + wrapPath(p, cols).length, 0);

/** Rough advance width of a Plex Sans string at 12 px (for edge-label pill sizing). */
export const estimateSansWidth = (text: string, fontSize: number = 12): number =>
  text.length * fontSize * 0.56;

/**
 * A doc path as people should read it: the `{{factoryPath}}/`, `{{skillPath}}/` and
 * `{{rootPath}}/` templates are how the harness resolves a knowledge file (the factory folder,
 * the wrapper skill folder, the harness root);
 * on screen the path relative to that location is enough, the template stays in `title`.
 */
export const displayDocPath = (path: string): string =>
  path.replace(/^\{\{(skillPath|rootPath|factoryPath)\}\}\/+/, '');
