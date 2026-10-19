import type { MouseEvent, ReactNode } from 'react';
import { buildPath, type Route } from '../lib/route';

interface NavLink {
  screen: Route['screen'];
  label: string;
  route: Route;
}

const LINKS: NavLink[] = [
  { screen: 'runs', label: 'Runs', route: { screen: 'runs', run: null } },
  { screen: 'sessions', label: 'Sessions', route: { screen: 'sessions' } },
];

interface TopbarProps {
  route: Route;
  /** Called on a plain left click; modified clicks fall through to the browser (new tab). */
  onNavigate: (route: Route) => void;
  /** Receives the slot element the screens fill (see `TopbarContent`). */
  onSlot: (element: HTMLElement | null) => void;
}

/**
 * The bar over the content, to the right of the sidebar: a link per screen, the current one
 * marked, then the slot the screen on show fills with its own line (the run's header, the live
 * indicator, Refresh). The brand lives at the top of the sidebar.
 */
export const Topbar = ({ route, onNavigate, onSlot }: TopbarProps): ReactNode => (
  <header className="topbar">
    <nav className="nav" aria-label="Screens">
      {LINKS.map((link: NavLink) => (
        <a
          key={link.screen}
          href={buildPath(link.route)}
          aria-current={route.screen === link.screen ? 'page' : undefined}
          onClick={(event: MouseEvent<HTMLAnchorElement>): void => {
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            onNavigate(link.route);
          }}
        >
          {link.label}
        </a>
      ))}
    </nav>
    <div className="topbar-slot" ref={onSlot} />
  </header>
);
