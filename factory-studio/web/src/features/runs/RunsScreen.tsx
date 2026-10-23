import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { buildGraph, type GraphResult, type ViewMode } from './lib/graph';
import { pickDefaultRun, resolvePipeline, type RunsFeed } from './hooks/use-runs-feed';
import { isActiveRun } from './runs.utils';
import type { DashboardData, Pipeline, RunRecord } from './runs.types';
import { navigate, writeRunTab, writeView, type RunRef, type RunTab } from '../../shared/lib/route';
import { readJson, writeJson } from '../../shared/lib/storage';
import { usePolling } from '../../shared/lib/polling';
import { questionsForRun, titleWithCount, useQuestions, type PendingQuestion } from '../sessions';
import { isTypingTarget } from '../../shared/lib/keys';
import ErrorScreen from './components/ErrorScreen';
import { RunView } from './components/RunView';
import { RunsIndex } from './components/RunsIndex';

const APP_NAME = 'Factory Studio';
const FAST_POLL_MS = 5_000;
const SLOW_POLL_MS = 30_000;
const EMPTY_GRAPH: GraphResult = { nodes: [], edges: [] };
/** The viewer's last chosen run tab: what a link without `?view=` opens on. */
const TAB_STORAGE_KEY = 'factory-studio.run-tab';

interface TabPrefs {
  tab: RunTab;
}

const readDefaultTab = (): RunTab =>
  readJson<TabPrefs>(TAB_STORAGE_KEY, { tab: 'graph' }).tab === 'timeline' ? 'timeline' : 'graph';

interface RunsScreenProps {
  /** The run list, owned by the shell so the sidebar has it on every screen. */
  feed: RunsFeed;
  /** The run in the route, or `null` for the index. */
  run: RunRef | null;
  view: ViewMode;
  /** The run tab the query names; null opens the viewer's default. */
  tab: RunTab | null;
}

const sameRef = (a: RunRef | null, b: RunRef | null): boolean =>
  a !== null && b !== null && a.pipelineId === b.pipelineId && a.runId === b.runId;

/**
 * The Runs screen: the index (tables and the grouped list) at `/runs`, one run at
 * `/runs/<pipelineId>/<runId>`. The list is polled here — fast while the shown run is moving,
 * slowly otherwise — and a refresh never touches the viewport.
 */
export const RunsScreen = ({
  feed,
  run: requested,
  view,
  tab: requestedTab,
}: RunsScreenProps): ReactNode => {
  const data: DashboardData = feed.data;
  const runs: RunRecord[] = data.runs;

  // The run the link asked for is kept until the person picks another one (or it turns up).
  const found: RunRecord | undefined = requested
    ? runs.find((r) => r.runId === requested.runId && r.pipelineId === requested.pipelineId)
    : undefined;
  // A link to a run not yet listed: nothing is drawn until the list has answered once (so
  // no other run flashes); if the run is still not there, the default run is shown with a
  // note saying which run is missing.
  const pending: boolean = requested !== null && !found && !feed.settled;
  const missing: RunRef | null = requested !== null && !found && feed.settled ? requested : null;
  const run: RunRecord | undefined = requested ? (found ?? pickDefaultRun(data)) : undefined;
  const pipeline: Pipeline | null = run ? resolvePipeline(data)(run) : null;
  // Claude's questions waiting in the studio: all of them for the tab title, this run's for the graph.
  const asked: PendingQuestion[] = useQuestions().state.pending;
  const asking: boolean = run !== undefined && questionsForRun(asked, run).length > 0;

  // Poll fast while the shown run is moving, slowly otherwise.
  usePolling(feed.refresh, isActiveRun(run) ? FAST_POLL_MS : SLOW_POLL_MS);

  useEffect(() => {
    if (pending) return;
    document.title = titleWithCount(
      run && requested ? `${run.runId} — ${APP_NAME}` : `Runs — ${APP_NAME}`,
      asked.length,
    );
  }, [run, requested, pending, asked.length]);

  const tab: RunTab = requestedTab ?? readDefaultTab();
  const chooseTab = useCallback((next: RunTab): void => {
    writeJson(TAB_STORAGE_KEY, { tab: next });
    writeRunTab(next);
  }, []);

  const toggleView = useCallback(
    (): void => writeView(view === 'detailed' ? 'compact' : 'detailed'),
    [view],
  );

  // `d` flips the card mode, a Graph control: on Timeline it would change nothing visible.
  useEffect(() => {
    if (requested === null || tab !== 'graph') return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'd' || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      toggleView();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleView, requested, tab]);

  const openRun = useCallback((ref: RunRef): void => {
    navigate({ screen: 'runs', run: ref });
  }, []);

  // Rebuilt only when the run object, its pipeline object, the card mode or `asking` changes (see mergeStable).
  const graph: GraphResult = useMemo(
    () =>
      pipeline
        ? buildGraph(pipeline, {
            detailed: view === 'detailed',
            cost: run?.cost ?? null,
            asking,
          })(run?.state ?? null)
        : EMPTY_GRAPH,
    [pipeline, run, view, asking],
  );

  // A list that failed its schema and nothing on screen to keep: say so, draw nothing.
  if (feed.invalid && runs.length === 0) {
    return (
      <div className="screen screen-runs">
        <ErrorScreen
          title="The run list is not valid"
          detail="GET /api/v1/runs answered with a body that does not match the run list schema, so nothing can be drawn from it."
          issues={feed.invalidIssues}
          onRetry={feed.refresh}
        />
      </div>
    );
  }

  if (requested === null) {
    return (
      <div className="screen screen-runs">
        <RunsIndex feed={feed} onOpen={openRun} />
      </div>
    );
  }

  if (pending) {
    return (
      <div className="screen screen-runs">
        <div className="empty loading-run" aria-busy="true">
          <p className="muted">Loading {requested.runId}…</p>
        </div>
      </div>
    );
  }

  if (!run) {
    // The link named a run and there are no runs at all: the index says so.
    return (
      <div className="screen screen-runs">
        <RunsIndex feed={feed} onOpen={openRun} />
      </div>
    );
  }

  return (
    <div className="screen screen-runs">
      <RunView
        feed={feed}
        run={run}
        pipeline={pipeline}
        graph={graph}
        missing={
          missing && !sameRef(missing, { pipelineId: run.pipelineId, runId: run.runId })
            ? missing
            : null
        }
        view={view}
        asking={asking}
        onToggleView={toggleView}
        tab={tab}
        onTab={chooseTab}
      />
    </div>
  );
};
