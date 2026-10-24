import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { navigate, useRoute, type RouteState, type RunRef } from './shared/lib/route';
import { Topbar } from './shared/components/Topbar';
import { TopbarSlotContext } from './shared/components/TopbarContent';
import { RunsScreen, RunSidebar, useRunsFeed, type RunsFeed } from './features/runs';
import { QuestionsProvider, SessionsScreen } from './features/sessions';
import {
  filterFeed,
  useWorkspacesContext,
  WorkspacesProvider,
  type Workspaces,
} from './features/workspaces';

/**
 * The shell: the sidebar down the left edge (the brand, then every run; it folds to a rail),
 * and beside it the top bar (the screen tabs and the line of the screen on show) over the
 * screen the route names. The run list is fetched here once, so the sidebar has it on every
 * screen; the Runs screen decides how often it is refreshed. The question socket is opened
 * here too, once, so a question can be answered on Sessions or on its run's page, and the
 * workspaces are read here once, so every screen filters by the same choice.
 */
export default function App(): ReactNode {
  return (
    <QuestionsProvider>
      <WorkspacesProvider>
        <Shell />
      </WorkspacesProvider>
    </QuestionsProvider>
  );
}

/** The layout inside the providers; the sidebar lists the chosen workspace's runs only. */
const Shell = (): ReactNode => {
  const { route, view, tab }: RouteState = useRoute();
  const feed: RunsFeed = useRunsFeed();
  const { selected }: Workspaces = useWorkspacesContext();
  const shown: RunsFeed = useMemo((): RunsFeed => filterFeed(selected)(feed), [selected, feed]);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  const openRun = useCallback((ref: RunRef): void => navigate({ screen: 'runs', run: ref }), []);

  const screen: ReactNode =
    route.screen === 'runs' ? (
      <RunsScreen feed={feed} workspace={selected} run={route.run} view={view} tab={tab} />
    ) : (
      <SessionsScreen chat={route.chat ?? null} />
    );

  return (
    <div className="app">
      <RunSidebar
        runs={shown.data.runs}
        workspaceName={selected?.name ?? null}
        current={route.screen === 'runs' ? route.run : null}
        onChoose={openRun}
      />
      <div className="app-body">
        <TopbarSlotContext.Provider value={slot}>
          <Topbar route={route} onNavigate={navigate} onSlot={setSlot} data={feed.data} />
          {screen}
        </TopbarSlotContext.Provider>
      </div>
    </div>
  );
};
