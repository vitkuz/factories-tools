import type { CSSProperties, ReactNode } from 'react';
import type { RunsFeed } from '../hooks/use-runs-feed';
import type { RunRecord } from '../runs.types';
import { isActiveRun, runDurationSeconds } from '../runs.utils';
import { formatDay, formatDurationMs, formatUSD } from '../lib/format';
import { runStatusWord } from '../lib/run';
import { useNow } from '../../../shared/lib/polling';
import LiveStatus from './LiveStatus';
import { runStatusToken } from './RunMeta';

interface RunHeaderProps {
  run: RunRecord;
  feed: RunsFeed;
  onBackToIndex: () => void;
}

/**
 * The run's own header line: the way back to the index, `pipeline /` and the run id, its
 * status, then day, duration and cost, with the live indicator at the right. The choice of
 * run is made in the sidebar; this line only names what is on screen.
 */
export const RunHeader = ({ run, feed, onBackToIndex }: RunHeaderProps): ReactNode => {
  const active: boolean = isActiveRun(run);
  const now: number = useNow(active ? 1_000 : 60_000);
  const seconds: number | null = runDurationSeconds(run, now);
  const token: string = runStatusToken(run);
  const colour: CSSProperties = { color: `var(${token})` };
  const dotStyle: CSSProperties = { background: `var(${token})` };
  const day: string = formatDay(run.state?.createdAt);

  return (
    <div className="subbar run-header">
      <button type="button" className="subbar-back" onClick={onBackToIndex}>
        All runs
      </button>
      <span className="run-header-pipeline mono">{run.pipelineId} /</span>
      <span className="run-header-id" title={run.runId}>
        {run.runId}
      </span>
      <span className="run-header-status mono" style={colour}>
        <span className="status-dot" style={dotStyle} aria-hidden="true" />
        {runStatusWord(run.state?.status)}
      </span>
      <span className="run-header-facts mono">
        {day && <span>{day}</span>}
        {seconds !== null && <span>{formatDurationMs(seconds * 1000)}</span>}
        {run.cost && <span>{formatUSD(run.cost.totals.estimatedListPriceUsd)}</span>}
      </span>
      <LiveStatus feed={feed} active={active} />
    </div>
  );
};
