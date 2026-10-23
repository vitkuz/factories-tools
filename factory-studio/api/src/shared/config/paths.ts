import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `factories-tools/factory-studio/api`: three levels up from `src/shared/config/`, and equally from
 * `dist/shared/config/`, so the same maths holds for `tsx` and for the compiled build.
 */
export const API_ROOT: string = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

/** The project root: two levels above `factories-tools/factory-studio`. */
export const REPO_ROOT: string = path.resolve(API_ROOT, '../../..');

/** The built app the API serves at `/`, unless `WEB_DIST` says otherwise. */
export const DEFAULT_WEB_DIST: string = path.join(API_ROOT, '..', 'web', 'dist');

/**
 * The question hook the harness runs. It sits in the package folder, outside `src/` and
 * `dist/`, and is plain JavaScript, so the same path holds for `tsx` and for the compiled build.
 */
export const HOOK_SCRIPT: string = path.join(API_ROOT, 'hooks', 'studio-question-hook.mjs');
