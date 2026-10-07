import { useEffect, useState } from 'react';
import type { ViewMode } from '../../features/runs/lib/graph';

export type { ViewMode };

/**
 * Screens and ids live in the path — `/editor/<pipelineId>`, `/runs/<pipelineId>/<runId>`,
 * `/sessions` — and the card detail mode stays in the hash as the dashboard wrote it
 * (`#view=detailed`). The API answers `index.html` for every non-`/api` path, so a reload
 * of any of these lands on the same screen.
 */

export interface RunRef {
  pipelineId: string;
  runId: string;
}

export type Route =
  | { screen: 'editor'; pipelineId: string | null }
  | { screen: 'runs'; run: RunRef | null }
  | { screen: 'sessions' };

const VIEW_KEY = 'view';

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
  const [screen, a, b]: string[] = segmentsOf(pathname);
  if (screen === undefined || screen === 'editor') {
    return { screen: 'editor', pipelineId: a ?? null };
  }
  if (screen === 'sessions') return { screen: 'sessions' };
  if (screen === 'runs' && a !== undefined && b !== undefined) {
    return { screen: 'runs', run: { pipelineId: a, runId: b } };
  }
  return { screen: 'runs', run: null };
};

export const buildPath = (route: Route): string => {
  switch (route.screen) {
    case 'editor':
      return route.pipelineId ? `/editor/${encodeURIComponent(route.pipelineId)}` : '/editor';
    case 'runs':
      return route.run
        ? `/runs/${encodeURIComponent(route.run.pipelineId)}/${encodeURIComponent(route.run.runId)}`
        : '/runs';
    case 'sessions':
      return '/sessions';
  }
};

export const readView = (hash: string): ViewMode => {
  const params: URLSearchParams = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  return params.get(VIEW_KEY) === 'detailed' ? 'detailed' : 'compact';
};

export const buildHash = (view: ViewMode): string => (view === 'detailed' ? '#view=detailed' : '');

/** A tiny listener set: `navigate` and `writeView` tell every `useRoute` to re-read the location. */
const listeners: Set<() => void> = new Set();

const notify = (): void => listeners.forEach((listen: () => void): void => listen());

const sameScreen = (a: Route, b: Route): boolean => a.screen === b.screen;

/** Go to a route: a new history entry when the screen changes, a replacement otherwise. The hash is kept. */
export const navigate = (route: Route): void => {
  const current: Route = parseRoute(window.location.pathname);
  const path: string = buildPath(route);
  const url: string = `${path}${window.location.hash}`;
  if (path === window.location.pathname) return;
  if (sameScreen(current, route)) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  notify();
};

/** Write the card mode into the hash without a history entry. */
export const writeView = (view: ViewMode): void => {
  const next: string = buildHash(view);
  if (window.location.hash === next) return;
  window.history.replaceState(null, '', next || window.location.pathname + window.location.search);
  notify();
};

export interface RouteState {
  route: Route;
  view: ViewMode;
}

const readLocation = (): RouteState => ({
  route: parseRoute(window.location.pathname),
  view: readView(window.location.hash),
});

/** The current route and view, updated on back/forward, hash edits and `navigate`/`writeView`. */
export const useRoute = (): RouteState => {
  const [state, setState] = useState<RouteState>(readLocation);
  useEffect(() => {
    const listen = (): void => setState(readLocation());
    listeners.add(listen);
    window.addEventListener('popstate', listen);
    window.addEventListener('hashchange', listen);
    return () => {
      listeners.delete(listen);
      window.removeEventListener('popstate', listen);
      window.removeEventListener('hashchange', listen);
    };
  }, []);
  return state;
};
