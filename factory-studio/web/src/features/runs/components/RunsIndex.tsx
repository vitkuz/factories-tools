import { useMemo, useState, type ReactNode } from 'react';
import type { RunsFeed } from '../hooks/use-runs-feed';
import type { Overview, RunGroup, RunOverview } from '../runs.types';
import { groupByPipeline, overviewOf } from '../runs.utils';
import type { RunRef } from '../../../shared/lib/route';
import { useNow } from '../../../shared/lib/polling';
import LiveStatus, { FeedFooter } from './LiveStatus';
import NoRuns from './NoRuns';
import { PipelineTable } from './PipelineTable';
import { RunList } from './RunList';
import { RunTable } from './RunTable';
import { Totals } from './Totals';

interface RunsIndexProps {
  feed: RunsFeed;
  onOpen: (run: RunRef) => void;
}

/** The index: totals, the per-pipeline and per-run tables, and the grouped list. */
export const RunsIndex = ({ feed, onOpen }: RunsIndexProps): ReactNode => {
  const now: number = useNow(30_000);
  const [filter, setFilter] = useState<string | null>(null);
  const overview: Overview = useMemo((): Overview => overviewOf(feed.data, now), [feed.data, now]);
  const groups: RunGroup[] = useMemo(
    (): RunGroup[] => groupByPipeline(feed.data.runs),
    [feed.data],
  );
  const runs: RunOverview[] = useMemo(
    (): RunOverview[] =>
      filter === null
        ? overview.runs
        : overview.runs.filter((run: RunOverview): boolean => run.pipelineId === filter),
    [overview, filter],
  );

  if (feed.data.runs.length === 0 && feed.settled) {
    return (
      <>
        <div className="subbar">
          <h2 className="subbar-title">Runs</h2>
          <LiveStatus feed={feed} active={false} />
        </div>
        <NoRuns feed={feed} />
      </>
    );
  }

  return (
    <>
      <div className="subbar">
        <h2 className="subbar-title">Runs</h2>
        <LiveStatus feed={feed} active={false} />
      </div>
      <div className="runs-index">
        <Totals overview={overview} />
        <section className="runs-section" aria-label="Pipelines">
          <h3 className="panel-title">Pipelines</h3>
          <PipelineTable pipelines={overview.pipelines} selected={filter} onFilter={setFilter} />
        </section>
        <section className="runs-section" aria-label="Runs table">
          <h3 className="panel-title">
            Runs{filter ? <span className="panel-note"> · {filter}</span> : null}
          </h3>
          <RunTable runs={runs} onOpen={onOpen} />
        </section>
        <section className="runs-section" aria-label="Runs by pipeline">
          <h3 className="panel-title">By pipeline</h3>
          <RunList groups={groups} onOpen={onOpen} />
        </section>
      </div>
      <FeedFooter feed={feed} />
    </>
  );
};
