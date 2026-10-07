// Learned from factories-tools/run-state/src/shared/utils/path.utils.ts
import path from 'node:path';

/**
 * A path relative to the repository root, with forward slashes, so state.json reads the same on
 * every machine; a path outside the repository stays absolute.
 */
export const repoRelative =
  (rootPath: string) =>
  (file: string): string => {
    const absolute: string = path.resolve(file);
    const relative: string = path.relative(rootPath, absolute);
    return relative.startsWith('..') || path.isAbsolute(relative)
      ? absolute
      : relative.split('\\').join('/');
  };

/** A relative path hangs off `base`; an absolute one is only normalised. */
export const toAbsolute =
  (base: string) =>
  (target: string): string =>
    path.isAbsolute(target) ? path.normalize(target) : path.join(base, target);

/** `/x/*.md`, `?`, `[`: a pattern, not a file. */
export const isGlob = (text: string): boolean => /[*?[\]{}]/.test(text);
