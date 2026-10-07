import type { MouseEvent, ReactNode } from 'react';
import { buildPath, type Route } from '../lib/route';
import { BrandMark } from './BrandMark';

const BRAND_LEAD = 'FACTORY';
const BRAND_TAG = 'STUDIO';

interface NavLink {
  screen: Route['screen'];
  label: string;
  route: Route;
}

const LINKS: NavLink[] = [
  { screen: 'editor', label: 'Editor', route: { screen: 'editor', pipelineId: null } },
  { screen: 'runs', label: 'Runs', route: { screen: 'runs', run: null } },
  { screen: 'sessions', label: 'Sessions', route: { screen: 'sessions' } },
];

interface TopbarProps {
  route: Route;
  /** Called on a plain left click; modified clicks fall through to the browser (new tab). */
  onNavigate: (route: Route) => void;
}

/** The one navigation: the brand, then a link per screen, the current one marked. */
export const Topbar = ({ route, onNavigate }: TopbarProps): ReactNode => (
  <header className="topbar">
    <h1 className="brand">
      <BrandMark />
      <span className="brand-lead">{BRAND_LEAD}</span>
      <span className="brand-tag">{BRAND_TAG}</span>
    </h1>
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
  </header>
);
