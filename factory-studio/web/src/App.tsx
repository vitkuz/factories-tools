import type { ReactNode } from 'react';
import { navigate, useRoute, type Route, type RouteState } from './shared/lib/route';
import { Topbar } from './shared/components/Topbar';
import { EditorScreen, editorDirty, LEAVE_MESSAGE } from './features/editor';
import { RunsScreen } from './features/runs';
import { SessionsScreen } from './features/sessions';

/** Leaving the editor with unsaved edits asks first; every other move is free. */
const confirmLeave = (current: Route, next: Route): boolean =>
  current.screen !== 'editor' || next.screen === 'editor' || !editorDirty.current
    ? true
    : window.confirm(LEAVE_MESSAGE);

/** The shell: the one navigation, and the screen the route names. Nothing else lives here. */
export default function App(): ReactNode {
  const { route, view }: RouteState = useRoute();

  const go = (next: Route): void => {
    if (confirmLeave(route, next)) navigate(next);
  };

  const screen: ReactNode =
    route.screen === 'editor' ? (
      <EditorScreen pipelineId={route.pipelineId} />
    ) : route.screen === 'runs' ? (
      <RunsScreen run={route.run} view={view} />
    ) : (
      <SessionsScreen />
    );

  return (
    <div className="app">
      <Topbar route={route} onNavigate={go} />
      {screen}
    </div>
  );
}
