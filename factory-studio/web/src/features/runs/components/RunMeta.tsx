import type { CSSProperties, ReactNode } from 'react';
import type { RunRecord } from '../lib/types';
import { formatDay, formatUSD } from '../lib/format';
import { RUN_STATUS_META, runStatusWord } from '../lib/run';

/** The CSS token of a run's status colour; a run without state is `--st-none`. */
export const runStatusToken = (run: RunRecord): string =>
  run.state ? RUN_STATUS_META[run.state.status].token : '--st-none';

/**
 * The quiet part of a run row on the index, in three columns: status (dot and word), day
 * and — when the run has a cost.json — its total cost. The columns are fixed-width, so every
 * dot sits on one vertical line and every day is flush right whether or not the row has one.
 */
export const RunMeta = ({ run }: { run: RunRecord }): ReactNode => {
  const day: string = formatDay(run.state?.createdAt);
  const dotStyle: CSSProperties = { background: `var(${runStatusToken(run)})` };
  return (
    <span className="run-meta">
      <span className="run-meta-status">
        <span className="status-dot" style={dotStyle} aria-hidden="true" />
        {runStatusWord(run.state?.status)}
      </span>
      <span className="run-meta-day">{day}</span>
      <span className="run-meta-cost">
        {run.cost ? formatUSD(run.cost.totals.estimatedListPriceUsd) : ''}
      </span>
    </span>
  );
};
