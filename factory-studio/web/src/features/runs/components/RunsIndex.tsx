import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { resolvePipeline, type RunsFeed } from '../hooks/use-runs-feed';
import { useRemoveRun, type RunRemover } from '../hooks/use-remove-run';
import type {
  DashboardData,
  Overview,
  PipelineOverview,
  RemoveRunOutcome,
  RunOverview,
  RunRecord,
  StepBreakdown,
} from '../runs.types';
import { stepBreakdownOf } from '../runs-breakdown.utils';
import {
  overviewOf,
  pickPipeline,
  pickRun,
  removedNotice,
  runsOfPipeline,
  sortByLastRun,
} from '../runs.utils';
import type { RunRef } from '../../../shared/lib/route';
import { useNow } from '../../../shared/lib/polling';
import { readJson, writeJson } from '../../../shared/lib/storage';
import { Notice } from '../../../shared/components/Notice';
import { TopbarContent } from '../../../shared/components/TopbarContent';
import { useWorkspacesContext } from '../../workspaces/hooks/use-workspaces';
import type { Workspace } from '../../workspaces/workspaces.types';
import { RunsFeedBar } from './LiveStatus';
import NoRuns from './NoRuns';
import { FactoryBar } from './FactoryBar';
import { PipelineHero } from './PipelineHero';
import { RunCards } from './RunCards';
import { RunPanel } from './RunPanel';

const STORAGE_KEY = 'studio.runs.home';
/** The run panel id: on a narrow screen it sits under the cards, and a pick scrolls to it. */
const RUN_PANEL_ID = 'run-panel';

interface HomePrefs {
  pipelineId: string | null;
}

interface RunsIndexProps {
  /** The run list as the chosen workspace sees it (the whole list for All). */
  feed: RunsFeed;
  /** The whole run list: the workspace dialog offers every factory in it. */
  allData?: DashboardData;
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
      <button type="button" className="btn" onClick={(): void => select(null)}>
        Show all
      </button>
    </div>
  );
};

/** The index's line in the top bar: the live indicator. */
const IndexBar = ({ feed }: { feed: RunsFeed }): ReactNode => (
  <TopbarContent>
    <div className="subbar">
      <RunsFeedBar feed={feed} active={false} />
    </div>
  </TopbarContent>
);

/** On a narrow screen the run panel sits under the cards: scroll the index to it after a pick. */
const revealPanel = (): void => {
  const panel: HTMLElement | null = document.getElementById(RUN_PANEL_ID);
  const cards: Element | null = document.querySelector('.run-cards');
  const scroller: Element | null = document.querySelector('.runs-index');
  if (panel === null || cards === null || scroller === null) return;
  const top: number = panel.getBoundingClientRect().top;
  if (top < cards.getBoundingClientRect().bottom - 1) return;
  scroller.scrollTo({
    top: scroller.scrollTop + top - scroller.getBoundingClientRect().top - 16,
    behavior: 'smooth',
  });
};

/**
 * The index: the factory bar (workspace and pipeline), the picked pipeline with its sums, then
 * two columns — its runs as cards, and the picked run with its per-step breakdown. The pipeline
 * pick is remembered in localStorage; the run pick defaults to the newest run.
 */
export const RunsIndex = ({
  feed,
  allData,
  workspace = null,
  totalRuns,
  onOpen,
}: RunsIndexProps): ReactNode => {
  const now: number = useNow(30_000);
  const remover: RunRemover = useRemoveRun(feed);
  const [wanted, setWanted] = useState<string | null>(() => readPrefs().pipelineId);
  const [wantedRun, setWantedRun] = useState<string | null>(null);
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
  const run: RunOverview | null = pickRun(wantedRun)(runs);

  const select = useCallback((pipelineId: string): void => {
    setWanted(pipelineId);
    setWantedRun(null);
    writeJson(STORAGE_KEY, { pipelineId });
  }, []);

  const selectRun = useCallback((ref: RunRef): void => {
    setWantedRun(ref.runId);
    requestAnimationFrame(revealPanel);
  }, []);

  // Read from the record the list carries (cost.json and state.json travel with it), again on
  // every push, so the panel follows a running run.
  const breakdown: StepBreakdown | null = useMemo((): StepBreakdown | null => {
    if (run === null) return null;
    const record: RunRecord | undefined = feed.data.runs.find(
      (r: RunRecord): boolean => r.pipelineId === run.pipelineId && r.runId === run.runId,
    );
    return record === undefined
      ? null
      : stepBreakdownOf(record, resolvePipeline(feed.data)(record), now);
  }, [feed.data, run, now]);

  const bar: ReactNode = (
    <FactoryBar
      allData={allData ?? feed.data}
      overview={overview}
      pipelines={pipelines}
      selected={selected?.pipelineId ?? null}
      onSelect={select}
    />
  );

  if (feed.data.runs.length === 0 && feed.settled && workspace !== null && (totalRuns ?? 0) > 0) {
    return (
      <>
        <IndexBar feed={feed} />
        <div className="page runs-index">
          {bar}
          <NoWorkspaceRuns workspace={workspace} />
        </div>
      </>
    );
  }

  if (feed.data.runs.length === 0 && feed.settled) {
    return (
      <>
        <IndexBar feed={feed} />
        <div className="page runs-index">
          {bar}
          <NoRuns />
        </div>
      </>
    );
  }

  return (
    <>
      <IndexBar feed={feed} />
      <div className="page runs-index">
        {bar}
        {selected ? (
          <PipelineHero
            pipeline={selected}
            runs={runs}
            description={feed.data.pipelines[selected.pipelineId]?.description}
          />
        ) : null}
        {remover.removed ? <Notice tone="ok">{removedNotice(remover.removed)}</Notice> : null}
        {selected ? (
          <div className="runs-home">
            <RunCards
              runs={runs}
              selected={run?.runId ?? null}
              onSelect={selectRun}
              onOpen={onOpen}
            />
            {run ? (
              <RunPanel
                key={run.runId}
                run={run}
                breakdown={breakdown}
                onOpen={onOpen}
                onRemove={(ref: RunRef): Promise<RemoveRunOutcome> => remover.remove(ref)}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
};
