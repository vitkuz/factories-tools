import type { MouseEvent, ReactNode } from 'react';
import type { PipelineOverview } from '../runs.types';
import { formatDay, formatDurationMs, formatTokens, formatUSD } from '../lib/format';

interface PipelineTableProps {
  pipelines: readonly PipelineOverview[];
  /** The pipeline the run table is filtered to, or `null` for every run. */
  selected: string | null;
  onFilter: (pipelineId: string | null) => void;
}

const money = (usd: number | null): string => (usd === null ? '—' : formatUSD(usd));
const count = (n: number | null): string => (n === null ? '—' : formatTokens(n));
const seconds = (s: number | null): string => (s === null ? '—' : formatDurationMs(s * 1000));

/**
 * Runs, steps and cost per pipeline. A row filters the run table below to that pipeline;
 * clicking it again clears the filter.
 */
export const PipelineTable = ({ pipelines, selected, onFilter }: PipelineTableProps): ReactNode => (
  <div className="grid-scroll">
    <table className="grid">
      <thead>
        <tr>
          <th>Pipeline</th>
          <th className="numeric">Runs</th>
          <th className="numeric">Steps</th>
          <th className="numeric">Cost</th>
          <th className="numeric">Tokens</th>
          <th className="numeric">Time</th>
          <th>Last run</th>
        </tr>
      </thead>
      <tbody>
        {pipelines.map((pipeline: PipelineOverview) => {
          const active: boolean = pipeline.pipelineId === selected;
          const toggle = (): void => onFilter(active ? null : pipeline.pipelineId);
          // Absent is not zero: a pipeline whose every run is unpriced has no cost to state.
          const allUnpriced: boolean = pipeline.runs > 0 && pipeline.unpriced === pipeline.runs;
          return (
            <tr
              key={pipeline.pipelineId}
              className="is-clickable"
              aria-current={active}
              onClick={toggle}
            >
              <td>
                <button
                  type="button"
                  className="row-button"
                  aria-pressed={active}
                  onClick={(event: MouseEvent<HTMLButtonElement>): void => {
                    // The row is a click target too; without this the toggle fires twice.
                    event.stopPropagation();
                    toggle();
                  }}
                >
                  <span className="mono">{pipeline.pipelineId}</span>
                </button>
              </td>
              <td className="numeric">{pipeline.runs}</td>
              <td className="numeric">{pipeline.steps}</td>
              {allUnpriced ? (
                <td className="numeric muted">unpriced</td>
              ) : (
                <td className="numeric money">
                  {money(pipeline.costUsd)}
                  {pipeline.unpriced > 0 ? (
                    <span className="cell-note">{pipeline.unpriced} unpriced</span>
                  ) : null}
                </td>
              )}
              <td className="numeric muted">{count(pipeline.totalTokens)}</td>
              <td className="numeric muted">{seconds(pipeline.durationSeconds)}</td>
              <td className="muted">{formatDay(pipeline.lastRunAt)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);
