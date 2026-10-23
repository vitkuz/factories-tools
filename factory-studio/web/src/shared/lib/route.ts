import { useEffect, useState } from 'react';
import type { ViewMode } from '../../features/runs/lib/graph';

export type { ViewMode };

/**
 * Screens and ids live in the path — `/runs`, `/runs/<pipelineId>/<runId>`, `/sessions`,
 * `/sessions/<session>` (that session's live chat over the board) —
 * the run page's tab in the query (`?view=graph|timeline`), and the card detail mode in the
 * hash (`#cards=detailed`; the dashboard's older `#view=detailed` is still read, and rewritten
 * the next time the mode is toggled).
 * The API answers `index.html` for every non-`/api` path, so a reload of any of these lands
 * on the same screen. `/` and every other path (an old `/editor/<id>` bookmark, say) open
 * the runs list.
 */

export interface RunRef {
  pipelineId: string;
  runId: string;
}

/** `chat`: the session whose live chat is open over the board (`/sessions/<session>`). */
export type Route =
  { screen: 'runs'; run: RunRef | null } | { screen: 'sessions'; chat?: string | null };

/** The run page's main area: the canvas, or the steps as a list in run order. */
export type RunTab = 'graph' | 'timeline';

export const RUN_TABS: readonly RunTab[] = ['graph', 'timeline'];

/** Query key of the run tab. */
const TAB_KEY = 'view';
/** Hash key of the card mode, and the one the dashboard used before the tabs took `view`. */
const CARDS_KEY = 'cards';
const LEGACY_CARDS_KEY = 'view';

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
  if (screen === 'sessions') return { screen: 'sessions', chat: a ?? null };
  if (screen === 'runs' && a !== undefined && b !== undefined) {
    return { screen: 'runs', run: { pipelineId: a, runId: b } };
  }
  return { screen: 'runs', run: null };
};

export const buildPath = (route: Route): string => {
  switch (route.screen) {
    case 'runs':
      return route.run
        ? `/runs/${encodeURIComponent(route.run.pipelineId)}/${encodeURIComponent(route.run.runId)}`
        : '/runs';
    case 'sessions':
      return route.chat ? `/sessions/${encodeURIComponent(route.chat)}` : '/sessions';
  }
};

const paramsOf = (text: string, lead: string): URLSearchParams =>
  new URLSearchParams(text.startsWith(lead) ? text.slice(1) : text);

/** The card mode from the hash: `#cards=detailed`, or an old link's `#view=detailed`. */
export const readView = (hash: string): ViewMode => {
  const params: URLSearchParams = paramsOf(hash, '#');
  const value: string | null = params.get(CARDS_KEY) ?? params.get(LEGACY_CARDS_KEY);
  return value === 'detailed' ? 'detailed' : 'compact';
};

export const buildHash = (view: ViewMode): string =>
  view === 'detailed' ? `#${CARDS_KEY}=detailed` : '';

/** The run tab the query names (`?view=timeline`); null when it names none or an unknown one. */
export const readRunTab = (search: string): RunTab | null => {
  const value: string | null = paramsOf(search, '?').get(TAB_KEY);
  return RUN_TABS.find((tab: RunTab): boolean => tab === value) ?? null;
};

/** `search` with the run tab set (other keys kept, in order), `?` included. */
export const buildSearch = (search: string, tab: RunTab): string => {
  const params: URLSearchParams = paramsOf(search, '?');
  params.set(TAB_KEY, tab);
  return `?${params.toString()}`;
};

/** A tiny listener set: `navigate`, `writeView` and `writeRunTab` tell every `useRoute` to re-read the location. */
const listeners: Set<() => void> = new Set();

const notify = (): void => listeners.forEach((listen: () => void): void => listen());

const sameScreen = (a: Route, b: Route): boolean => a.screen === b.screen;

/**
 * Go to a route: a new history entry when the screen changes, a replacement otherwise. The
 * hash is kept; the query (the run tab) only from one run to another.
 */
export const navigate = (route: Route): void => {
  const current: Route = parseRoute(window.location.pathname);
  const path: string = buildPath(route);
  const search: string = route.screen === 'runs' && route.run ? window.location.search : '';
  const url: string = `${path}${search}${window.location.hash}`;
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

/** Write the run tab into the query without a history entry; the hash is kept. */
export const writeRunTab = (tab: RunTab): void => {
  const { pathname, search, hash }: Location = window.location;
  const next: string = buildSearch(search, tab);
  if (next === search) return;
  window.history.replaceState(null, '', `${pathname}${next}${hash}`);
  notify();
};

export interface RouteState {
  route: Route;
  view: ViewMode;
  /** The run tab the query names; null leaves it to the viewer's default. */
  tab: RunTab | null;
}

/** `/` is the runs list as it is; any other path the routes do not name is rewritten in place. */
const isCanonical = (pathname: string): boolean =>
  pathname === '/' || pathname === buildPath(parseRoute(pathname));

/**
 * Replace a path no screen owns (`/editor/<id>`, a stray `/runs/<id>`) with the one it
 * opens, without a history entry, so the address bar names the screen on view.
 */
const canonicalise = (): void => {
  const { pathname, search, hash }: Location = window.location;
  if (isCanonical(pathname)) return;
  window.history.replaceState(null, '', `${buildPath(parseRoute(pathname))}${search}${hash}`);
};

const readLocation = (): RouteState => ({
  route: parseRoute(window.location.pathname),
  view: readView(window.location.hash),
  tab: readRunTab(window.location.search),
});

/** The current route, card mode and run tab, updated on back/forward, hash edits and the writers above. */
export const useRoute = (): RouteState => {
  const [state, setState] = useState<RouteState>(readLocation);
  useEffect(() => {
    canonicalise();
    const listen = (): void => {
      canonicalise();
      setState(readLocation());
    };
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
