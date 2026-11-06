import type { FactorySession } from '../sessions/sessions.types.js';
import type { RunPathKind } from './live.types.js';

/** A run the recorder may still write to: not finished, not failed, not aborted. Pure. */
export const isActiveRunStatus = (status: string | null | undefined): boolean =>
  status === 'RUNNING' || status === 'PAUSED' || status === 'IDLE';

/** The three files of a run folder that make its record; anything else is an output. */
const RECORD_FILES: readonly string[] = ['state.json', 'cost.json', 'pipeline.json'];
const WORKSPACES_FILE = 'workspaces.json';

/** Names the recorder, editors and the API itself write and rename away: not worth a push. */
const isTransient = (name: string): boolean =>
  name.startsWith('.') || /\.tmp(-\d+)?$/.test(name) || /\.[0-9a-f-]{36}\.tmp$/.test(name);

/**
 * What a path relative to `run/` names (`/` separators). `.trash` and dotfiles are ignored;
 * `workspaces.json` is its own thing; a bare `<folder>` is a pipeline folder appearing or
 * going; `<folder>/<runId>[/rest]` is one run. An empty path means the watcher lost track:
 * rescan. Pure.
 */
export const classifyRunPath = (relative: string): RunPathKind => {
  const segments: string[] = relative.split('/').filter((s: string): boolean => s !== '');
  if (segments.length === 0) return { kind: 'rescan' };
  const [folder, runId, ...rest]: string[] = segments;
  if (folder === undefined || folder.startsWith('.')) return { kind: 'ignore' };
  if (segments.length === 1) {
    if (folder === WORKSPACES_FILE) return { kind: 'workspaces' };
    return isTransient(folder) ? { kind: 'ignore' } : { kind: 'folder', folder };
  }
  if (runId === undefined || isTransient(runId)) return { kind: 'ignore' };
  const last: string | undefined = rest[rest.length - 1];
  if (last !== undefined && isTransient(last)) return { kind: 'ignore' };
  return { kind: 'run', folder, runId, rest: rest.join('/') };
};

/** The paths of one run change that touch its record: the folder itself or one of its three files. */
export const touchesRecord = (paths: readonly string[]): boolean =>
  paths.some((p: string): boolean => p === '' || RECORD_FILES.includes(p));

/** A `pipeline.json` anywhere under a factories tree (`<id>/pipeline.json`). */
export const isPipelineFile = (relative: string): boolean => /(^|\/)pipeline\.json$/.test(relative);

/**
 * The session list as the client needs to see it change: everything but the ages, which move
 * every second and are recomputed in the browser from `startedAt`. Pure.
 */
export const sessionsFingerprint = (sessions: readonly FactorySession[]): string =>
  JSON.stringify(
    [...sessions]
      .map((s: FactorySession): Omit<FactorySession, 'ageSeconds' | 'age'> => {
        const { ageSeconds: _a, age: _b, ...rest }: FactorySession = s;
        return rest;
      })
      .sort((a, b): number => a.session.localeCompare(b.session)),
  );

/** The frame's `type` when it is a JSON object that carries one. */
const typeOf = (raw: string): string | null => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && 'type' in value
      ? String((value as { type: unknown }).type)
      : null;
  } catch {
    return null;
  }
};

export const isLiveFrame = (raw: string): boolean => (typeOf(raw) ?? '').startsWith('live.');

const depth = (p: string): number => p.split('/').length;

/** At most `limit` paths, shallowest first so the record files come before deep outputs. */
export const capPaths = (paths: readonly string[], limit: number = 200): string[] =>
  [...new Set(paths)]
    .sort((a, b): number => depth(a) - depth(b) || a.length - b.length || a.localeCompare(b))
    .slice(0, limit);
