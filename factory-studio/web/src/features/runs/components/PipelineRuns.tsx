import type { ReactNode } from 'react';
import type { PipelineOverview, RunOverview } from '../runs.types';
import { isAllUnpriced } from '../runs.utils';
import type { RunRef } from '../../../shared/lib/route';
import { formatDay, formatDurationMs, formatTokens, formatUSD } from '../lib/format';
import { RunTable } from './RunTable';

interface PipelineRunsProps {
  pipeline: PipelineOverview;
  runs: readonly RunOverview[];
  onOpen: (run: RunRef) => void;
}

interface StatProps {
  label: string;
  value: string;
  /** Green, as money is everywhere on the index. */
  money?: boolean;
  /** Muted value: the figure is absent, not zero. */
  absent?: boolean;
  note?: string;
}

const Stat = ({ label, value, money, absent, note }: StatProps): ReactNode => (
  <div className="pipeline-stat">
    <span className="pipeline-stat-label">{label}</span>
    <span
      className={['pipeline-stat-value', money ? 'is-money' : '', absent ? 'is-absent' : '']
        .filter(Boolean)
        .join(' ')}
    >
      {value}
    </span>
    {note ? <span className="pipeline-stat-note">{note}</span> : null}
  </div>
);

/** The right column of the home: the picked pipeline's name, its five sums and its runs. */
export const PipelineRuns = ({ pipeline, runs, onOpen }: PipelineRunsProps): ReactNode => {
  // Absent is not zero: with no cost.json behind any run there is no cost to state.
  const cost: number | null = isAllUnpriced(pipeline) ? null : pipeline.costUsd;
  const lastRun: string = formatDay(pipeline.lastRunAt);
  return (
    <section className="pipeline-runs" aria-label="Runs of the selected pipeline">
      <div className="pipeline-runs-head">
        <div className="pipeline-runs-title">
          <span className="panel-title">Runs</span>
          <h2 className="pipeline-runs-name mono">{pipeline.pipelineId}</h2>
        </div>
        {lastRun ? <span className="pipeline-runs-last">Last run {lastRun}</span> : null}
      </div>
      <div className="pipeline-stats">
        <Stat label="Runs" value={String(pipeline.runs)} />
        <Stat label="Steps" value={String(pipeline.steps)} />
        <Stat
          label="Cost"
          value={cost === null ? 'unpriced' : formatUSD(cost)}
          money={cost !== null}
          absent={cost === null}
          note={
            cost !== null && pipeline.unpriced > 0 ? `${pipeline.unpriced} unpriced` : undefined
          }
        />
        <Stat
          label="Tokens"
          value={pipeline.totalTokens === null ? '—' : formatTokens(pipeline.totalTokens)}
          absent={pipeline.totalTokens === null}
        />
        <Stat
          label="Time"
          value={
            pipeline.durationSeconds === null
              ? '—'
              : formatDurationMs(pipeline.durationSeconds * 1000)
          }
          absent={pipeline.durationSeconds === null}
        />
      </div>
      <RunTable runs={runs} onOpen={onOpen} />
    </section>
  );
};
