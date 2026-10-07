import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { RunOverview } from '../runs.types';
import type { RunRef } from '../../../shared/lib/route';
import { formatDay, formatDurationMs, formatUSD } from '../lib/format';

interface RunTableProps {
  runs: readonly RunOverview[];
  onOpen: (run: RunRef) => void;
}

const seconds = (s: number | null): string => (s === null ? '—' : formatDurationMs(s * 1000));

/** The status word as a CSS token: `no state` → `no-state`. */
const statusToken = (status: string): string => status.toLowerCase().replace(/\s+/g, '-');

/** Every run, newest first; a row opens the run's graph. */
export const RunTable = ({ runs, onOpen }: RunTableProps): ReactNode => (
  <div className="grid-scroll">
    <table className="grid">
      <colgroup>
        <col />
        <col style={{ width: '170px' }} />
        <col style={{ width: '150px' }} />
        <col style={{ width: '70px' }} />
        <col style={{ width: '80px' }} />
        <col style={{ width: '80px' }} />
        <col style={{ width: '110px' }} />
      </colgroup>
      <thead>
        <tr>
          <th>Run</th>
          <th>Pipeline</th>
          <th>Status</th>
          <th className="numeric">Steps</th>
          <th className="numeric">Time</th>
          <th className="numeric">Cost</th>
          <th>Started</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run: RunOverview) => {
          const ref: RunRef = { pipelineId: run.pipelineId, runId: run.runId };
          return (
            <tr
              key={`${run.pipelineId}/${run.runId}`}
              className="is-clickable"
              onClick={(): void => onOpen(ref)}
            >
              <td>
                <button
                  type="button"
                  className="row-button"
                  onClick={(event: MouseEvent<HTMLButtonElement>): void => {
                    // The row is a click target too; without this the open fires twice.
                    event.stopPropagation();
                    onOpen(ref);
                  }}
                  onKeyDown={(event: KeyboardEvent<HTMLButtonElement>): void => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      event.stopPropagation();
                      onOpen(ref);
                    }
                  }}
                >
                  <span className="mono">{run.runId}</span>
                </button>
              </td>
              <td className="mono muted">{run.pipelineId}</td>
              <td>
                <span className={`status status--${statusToken(run.status)}`}>{run.status}</span>
                {run.stepsSkipped > 0 ? (
                  <span className="chip chip--skipped">{run.stepsSkipped} skipped</span>
                ) : null}
              </td>
              <td className="numeric">{run.steps}</td>
              <td className="numeric muted">{seconds(run.durationSeconds)}</td>
              <td className="numeric money">
                {run.priced && run.costUsd !== null ? (
                  formatUSD(run.costUsd)
                ) : (
                  <span className="muted">unpriced</span>
                )}
              </td>
              <td className="muted nowrap">{formatDay(run.startedAt)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);
