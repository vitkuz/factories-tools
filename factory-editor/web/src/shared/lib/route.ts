import { useEffect, useState } from 'react';

/**
 * The pipeline being edited lives in the path — `/` or `/editor` for the picker's default,
 * `/editor/<pipelineId>` for one pipeline. The API answers `index.html` for every non-`/api`
 * path, so a reload of either lands on the same pipeline.
 */

export interface Route {
  screen: 'editor';
  pipelineId: string | null;
}

const segmentsOf = (pathname: string): string[] =>
  pathname
    .split('/')
    .filter(Boolean)
    .map((seg: string): string => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    });

export const parseRoute = (pathname: string): Route => {
  const [screen, id]: string[] = segmentsOf(pathname);
  return { screen: 'editor', pipelineId: screen === 'editor' ? (id ?? null) : null };
};

export const buildPath = (route: Route): string =>
  route.pipelineId ? `/editor/${encodeURIComponent(route.pipelineId)}` : '/editor';

/** A tiny listener set: `navigate` tells every `useRoute` to re-read the location. */
const listeners: Set<() => void> = new Set();

const notify = (): void => listeners.forEach((listen: () => void): void => listen());

/**
 * Go to a route. Switching pipelines replaces the history entry (as it always has: the picker
 * is not a trail to walk back through). The hash is kept.
 */
export const navigate = (route: Route): void => {
  const path: string = buildPath(route);
  if (path === window.location.pathname) return;
  window.history.replaceState(null, '', `${path}${window.location.hash}`);
  notify();
};

export interface RouteState {
  route: Route;
}

const readLocation = (): RouteState => ({ route: parseRoute(window.location.pathname) });

/** The current route, updated on back/forward and `navigate`. */
export const useRoute = (): RouteState => {
  const [state, setState] = useState<RouteState>(readLocation);
  useEffect(() => {
    const listen = (): void => setState(readLocation());
    listeners.add(listen);
    window.addEventListener('popstate', listen);
    return () => {
      listeners.delete(listen);
      window.removeEventListener('popstate', listen);
    };
  }, []);
  return state;
};
