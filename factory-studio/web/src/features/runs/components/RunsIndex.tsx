import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { RunsFeed } from '../hooks/use-runs-feed';
import { useRemoveRun, type RunRemover } from '../hooks/use-remove-run';
import type { Overview, PipelineOverview, RunOverview } from '../runs.types';
import { overviewOf, pickPipeline, runsOfPipeline, sortByLastRun } from '../runs.utils';
import type { RunRef } from '../../../shared/lib/route';
import { useNow } from '../../../shared/lib/polling';
import { readJson, writeJson } from '../../../shared/lib/storage';
import { TopbarContent } from '../../../shared/components/TopbarContent';
import { useWorkspacesContext } from '../../workspaces/hooks/use-workspaces';
import type { Workspace } from '../../workspaces/workspaces.types';
import { RunsFeedBar } from './LiveStatus';
import NoRuns from './NoRuns';
import { PipelineList } from './PipelineList';
import { PipelineRuns } from './PipelineRuns';
import { Totals } from './Totals';

const STORAGE_KEY = 'studio.runs.home';

interface HomePrefs {
  pipelineId: string | null;
}

interface RunsIndexProps {
  /** The run list as the chosen workspace sees it (the whole list for All). */
  feed: RunsFeed;
  /** The chosen workspace, or `null` for All. */
  workspace?: Workspace | null;
  /** Runs in the whole list, so a workspace with none of them is not read as "no runs yet". */
  totalRuns?: number;
  onOpen: (run: RunRef) => void;
}

const readPrefs = (): HomePrefs => readJson<HomePrefs>(STORAGE_KEY, { pipelineId: null });

/** A workspace whose factories have no runs, while other factories do: say so, offer All. */
const NoWorkspaceRuns = ({ workspace }: { workspace: Workspace }): ReactNode => {
  const { select } = useWorkspacesContext();
  return (
    <div className="empty ws-no-runs">
      <p className="muted">
        No runs in workspace <strong>{workspace.name}</strong>.
      </p>
      <button type="button" className="feed-refresh" onClick={(): void => select(null)}>
        Show all
      </button>
    </div>
  );
};

/** The index's line in the top bar: when the list was read, the live indicator, Refresh. */
const IndexBar = ({ feed }: { feed: RunsFeed }): ReactNode => (
  <TopbarContent>
    <div className="subbar">
      <RunsFeedBar feed={feed} active={false} />
    </div>
  </TopbarContent>
);

/**
 * The index: the totals over two columns — the pipelines, newest last run first, and the
 * runs of the one picked (the newest by default; the pick is remembered in localStorage).
 */
export const RunsIndex = ({
  feed,
  workspace = null,
  totalRuns,
  onOpen,
}: RunsIndexProps): ReactNode => {
  const now: number = useNow(30_000);
  const remover: RunRemover = useRemoveRun(feed);
  const [wanted, setWanted] = useState<string | null>(() => readPrefs().pipelineId);
  const overview: Overview = useMemo((): Overview => overviewOf(feed.data, now), [feed.data, now]);
  const pipelines: PipelineOverview[] = useMemo(
    (): PipelineOverview[] => sortByLastRun(overview.pipelines),
    [overview],
  );
  const selected: PipelineOverview | null = pickPipeline(wanted)(pipelines);
  const runs: RunOverview[] = useMemo(
    (): RunOverview[] => (selected ? runsOfPipeline(selected.pipelineId)(overview.runs) : []),
    [overview, selected],
  );

  const select = useCallback((pipelineId: string): void => {
    setWanted(pipelineId);
    writeJson(STORAGE_KEY, { pipelineId });
  }, []);

  if (feed.data.runs.length === 0 && feed.settled && workspace !== null && (totalRuns ?? 0) > 0) {
    return (
      <>
        <IndexBar feed={feed} />
        <NoWorkspaceRuns workspace={workspace} />
      </>
    );
  }

  if (feed.data.runs.length === 0 && feed.settled) {
    return (
      <>
        <IndexBar feed={feed} />
        <NoRuns feed={feed} />
      </>
    );
  }

  return (
    <>
      <IndexBar feed={feed} />
      <div className="runs-index">
        <Totals overview={overview} />
        <div className="runs-home">
          <PipelineList
            pipelines={pipelines}
            selected={selected?.pipelineId ?? null}
            onSelect={select}
          />
          {selected ? (
            <PipelineRuns pipeline={selected} runs={runs} onOpen={onOpen} remover={remover} />
          ) : null}
        </div>
      </div>
    </>
  );
};
