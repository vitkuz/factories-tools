import type { ReactNode } from 'react';
import type { PipelineOverview } from '../runs.types';
import { isAllUnpriced, pipelineSummary } from '../runs.utils';
import { formatDay, formatUSD } from '../lib/format';

interface PipelineListProps {
  /** Already sorted by last run. */
  pipelines: readonly PipelineOverview[];
  /** The pipeline whose runs the right column shows. */
  selected: string | null;
  onSelect: (pipelineId: string) => void;
}

const PipelineCost = ({ pipeline }: { pipeline: PipelineOverview }): ReactNode =>
  isAllUnpriced(pipeline) || pipeline.costUsd === null ? (
    <span className="pipeline-row-cost is-unpriced">unpriced</span>
  ) : (
    <span className="pipeline-row-cost">{formatUSD(pipeline.costUsd)}</span>
  );

/**
 * The left column of the home: one row per pipeline, newest last run first — name and
 * counts on the left, cost and last-run day on the right. A row picks the pipeline whose
 * runs the right column lists.
 */
export const PipelineList = ({ pipelines, selected, onSelect }: PipelineListProps): ReactNode => (
  <aside className="pipeline-panel" aria-label="Pipelines">
    <div className="pipeline-panel-head">
      <h2 className="panel-title">Pipelines</h2>
      <span className="pipeline-panel-note">sorted by last run</span>
    </div>
    <ul className="pipeline-rows">
      {pipelines.map((pipeline: PipelineOverview) => (
        <li key={pipeline.pipelineId}>
          <button
            type="button"
            className="pipeline-row"
            aria-pressed={pipeline.pipelineId === selected}
            onClick={(): void => onSelect(pipeline.pipelineId)}
          >
            <span className="pipeline-row-main">
              <span className="pipeline-row-name mono">{pipeline.pipelineId}</span>
              <span className="pipeline-row-meta">{pipelineSummary(pipeline)}</span>
            </span>
            <span className="pipeline-row-side">
              <PipelineCost pipeline={pipeline} />
              <span className="pipeline-row-meta">{formatDay(pipeline.lastRunAt) || '—'}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  </aside>
);
