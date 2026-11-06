import type { ReactNode } from 'react';
import type { PipelineAverages, PipelineOverview, RunOverview } from '../runs.types';
import { isAllUnpriced, pipelineAveragesOf, statusSummary } from '../runs.utils';
import { formatDay, formatDurationMs, formatTokens, formatUSD } from '../lib/format';

interface PipelineHeroProps {
  pipeline: PipelineOverview;
  /** The pipeline's runs, for the status line and the averages. */
  runs: readonly RunOverview[];
  /** The pipeline's `description` from pipeline.json; nothing shows when it has none. */
  description?: string;
}

interface StatProps {
  label: string;
  value: string;
  /** Green, as money is everywhere on the page. */
  money?: boolean;
  /** Muted value: the figure is absent, not zero. */
  absent?: boolean;
  note?: string;
}

const Stat = ({ label, value, money, absent, note }: StatProps): ReactNode => (
  <div className="ri-stat">
    <span className="ri-stat-label">{label}</span>
    <span
      className={['ri-stat-value', money ? 'is-money' : '', absent ? 'is-absent' : '']
        .filter(Boolean)
        .join(' ')}
    >
      {value}
    </span>
    {note ? <span className="ri-stat-note">{note}</span> : null}
  </div>
);

const perRun = (value: string | null): string | undefined =>
  value === null ? undefined : `avg ${value} / run`;

const seconds = (s: number | null): string | null =>
  s === null ? null : formatDurationMs(Math.round(s) * 1000);

/** The picked pipeline: its name, its description, its last run day and the four sums with their per-run average. */
export const PipelineHero = ({ pipeline, runs, description }: PipelineHeroProps): ReactNode => {
  // Absent is not zero: with no cost.json behind any run there is no cost to state.
  const cost: number | null = isAllUnpriced(pipeline) ? null : pipeline.costUsd;
  const avg: PipelineAverages = pipelineAveragesOf(runs);
  const lastRun: string = formatDay(pipeline.lastRunAt);
  const costNote: string | undefined = [
    perRun(avg.costUsd === null ? null : formatUSD(avg.costUsd)),
    cost !== null && pipeline.unpriced > 0 ? `${pipeline.unpriced} unpriced` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <section className="panel pipeline-hero" aria-label="Selected pipeline">
      <div className="panel-intro">
        <div className="panel-intro-title">
          <span className="kicker">Pipeline</span>
          <h1 className="pipeline-hero-name">{pipeline.pipelineId}</h1>
          {description ? <p className="pipeline-hero-description">{description}</p> : null}
        </div>
        {lastRun ? <span className="panel-note">Last run {lastRun}</span> : null}
      </div>
      <div className="ri-stats ri-stats--hero">
        <Stat label="Runs" value={String(pipeline.runs)} note={statusSummary(runs) || undefined} />
        <Stat
          label="Cost"
          value={cost === null ? 'unpriced' : formatUSD(cost)}
          money={cost !== null}
          absent={cost === null}
          note={costNote || undefined}
        />
        <Stat
          label="Tokens"
          value={pipeline.totalTokens === null ? '—' : formatTokens(pipeline.totalTokens)}
          absent={pipeline.totalTokens === null}
          note={perRun(avg.totalTokens === null ? null : formatTokens(avg.totalTokens))}
        />
        <Stat
          label="Time"
          value={seconds(pipeline.durationSeconds) ?? '—'}
          absent={pipeline.durationSeconds === null}
          note={perRun(seconds(avg.durationSeconds))}
        />
      </div>
    </section>
  );
};
