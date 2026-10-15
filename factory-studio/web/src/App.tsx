import type { ReactNode } from 'react';
import { navigate, useRoute, type RouteState } from './shared/lib/route';
import { Topbar } from './shared/components/Topbar';
import { RunsScreen } from './features/runs';
import { SessionsScreen } from './features/sessions';

/** The shell: the one navigation, and the screen the route names. Nothing else lives here. */
export default function App(): ReactNode {
  const { route, view }: RouteState = useRoute();

  const screen: ReactNode =
    route.screen === 'runs' ? <RunsScreen run={route.run} view={view} /> : <SessionsScreen />;

  return (
    <div className="app">
      <Topbar route={route} onNavigate={navigate} />
      {screen}
    </div>
  );
}
