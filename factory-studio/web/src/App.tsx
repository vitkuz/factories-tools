import { useCallback, useState, type ReactNode } from 'react';
import { navigate, useRoute, type RouteState, type RunRef } from './shared/lib/route';
import { Topbar } from './shared/components/Topbar';
import { TopbarSlotContext } from './shared/components/TopbarContent';
import { RunsScreen, RunSidebar, useRunsFeed, type RunsFeed } from './features/runs';
import { QuestionsProvider, SessionsScreen } from './features/sessions';

/**
 * The shell: the sidebar down the left edge (the brand, then every run; it folds to a rail),
 * and beside it the top bar (the screen tabs and the line of the screen on show) over the
 * screen the route names. The run list is fetched here once, so the sidebar has it on every
 * screen; the Runs screen decides how often it is refreshed. The question socket is opened
 * here too, once, so a question can be answered on Sessions or on its run's page.
 */
export default function App(): ReactNode {
  const { route, view }: RouteState = useRoute();
  const feed: RunsFeed = useRunsFeed();
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  const openRun = useCallback((ref: RunRef): void => navigate({ screen: 'runs', run: ref }), []);

  const screen: ReactNode =
    route.screen === 'runs' ? (
      <RunsScreen feed={feed} run={route.run} view={view} />
    ) : (
      <SessionsScreen chat={route.chat ?? null} />
    );

  return (
    <QuestionsProvider>
      <div className="app">
        <RunSidebar
          runs={feed.data.runs}
          current={route.screen === 'runs' ? route.run : null}
          onChoose={openRun}
        />
        <div className="app-body">
          <TopbarSlotContext.Provider value={slot}>
            <Topbar route={route} onNavigate={navigate} onSlot={setSlot} />
            {screen}
          </TopbarSlotContext.Provider>
        </div>
      </div>
    </QuestionsProvider>
  );
}
