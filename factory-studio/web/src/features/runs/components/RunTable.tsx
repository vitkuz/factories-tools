import {
  Fragment,
  useCallback,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type { RemoveRunOutcome, RunOverview } from '../runs.types';
import type { RunRef } from '../../../shared/lib/route';
import { formatDay, formatDurationMs, formatUSD } from '../lib/format';
import { RemoveRunButton, RemoveRunConfirm } from './RemoveRun';

interface RunTableProps {
  runs: readonly RunOverview[];
  onOpen: (run: RunRef) => void;
  /** Moves a run to `run/.trash`; without it the table has no bin column. */
  onRemove?: (run: RunRef) => Promise<RemoveRunOutcome>;
}

/** The one confirm open in the table, if any. */
interface Confirming {
  key: string;
  busy: boolean;
  error: string | null;
}

const COLUMNS = 7;

const rowKey = (run: RunRef): string => `${run.pipelineId}/${run.runId}`;

const removeButtonId = (run: RunRef): string => `remove-run-${run.pipelineId}-${run.runId}`;

const seconds = (s: number | null): string => (s === null ? '—' : formatDurationMs(s * 1000));

/** The status word in its colour; a run without state reads quietly, its dot grey. */
const statusStyle = (run: RunOverview): CSSProperties | undefined =>
  run.hasState ? { color: `var(${run.statusToken})` } : undefined;

/**
 * The runs of one pipeline, newest first; a row opens the run's graph. The bin at the end of
 * a row opens a confirm under it; the run moves to `run/.trash` only from there.
 */
export const RunTable = ({ runs, onOpen, onRemove }: RunTableProps): ReactNode => {
  const [confirming, setConfirming] = useState<Confirming | null>(null);

  const cancel = useCallback((ref: RunRef): void => {
    setConfirming(null);
    // Back to the bin it came from, so the keyboard does not lose its place.
    document.getElementById(removeButtonId(ref))?.focus();
  }, []);

  const confirm = useCallback(
    async (ref: RunRef): Promise<void> => {
      if (!onRemove) return;
      const key: string = rowKey(ref);
      setConfirming({ key, busy: true, error: null });
      const outcome: RemoveRunOutcome = await onRemove(ref);
      setConfirming((now: Confirming | null): Confirming | null =>
        now?.key !== key ? now : outcome.ok ? null : { key, busy: false, error: outcome.message },
      );
    },
    [onRemove],
  );

  return (
    <div className="grid-scroll">
      <table className="grid grid--panel">
        <thead>
          <tr>
            <th>Run</th>
            <th>Status</th>
            <th className="numeric">Steps</th>
            <th className="numeric">Time</th>
            <th className="numeric">Cost</th>
            <th>Started</th>
            {onRemove ? (
              <th className="row-actions">
                <span className="visually-hidden">Remove</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {runs.map((run: RunOverview) => {
            const ref: RunRef = { pipelineId: run.pipelineId, runId: run.runId };
            const dotStyle: CSSProperties = { background: `var(${run.statusToken})` };
            const open: Confirming | null = confirming?.key === rowKey(ref) ? confirming : null;
            return (
              <Fragment key={rowKey(ref)}>
                <tr
                  className={open ? 'is-clickable is-confirming' : 'is-clickable'}
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
                  <td className="nowrap">
                    <span className="run-status">
                      <span className="status-dot" style={dotStyle} aria-hidden="true" />
                      <span className="run-status-word" style={statusStyle(run)}>
                        {run.status}
                      </span>
                      {run.stepsSkipped > 0 ? (
                        <span className="chip chip--skipped">{run.stepsSkipped} skipped</span>
                      ) : null}
                    </span>
                  </td>
                  <td className="numeric">{run.steps > 0 ? run.steps : '—'}</td>
                  <td className="numeric muted">{seconds(run.durationSeconds)}</td>
                  <td className="numeric money mono">
                    {run.priced && run.costUsd !== null ? (
                      formatUSD(run.costUsd)
                    ) : (
                      <span className="muted">unpriced</span>
                    )}
                  </td>
                  <td className="muted nowrap">{formatDay(run.startedAt) || '—'}</td>
                  {onRemove ? (
                    <td className="row-actions">
                      <RemoveRunButton
                        runId={run.runId}
                        id={removeButtonId(ref)}
                        open={open !== null}
                        onOpen={(): void =>
                          open
                            ? cancel(ref)
                            : setConfirming({ key: rowKey(ref), busy: false, error: null })
                        }
                      />
                    </td>
                  ) : null}
                </tr>
                {open ? (
                  <tr className="run-remove-row">
                    <td colSpan={COLUMNS}>
                      <RemoveRunConfirm
                        runId={run.runId}
                        pipelineId={run.pipelineId}
                        active={run.active}
                        busy={open.busy}
                        error={open.error}
                        onConfirm={(): void => void confirm(ref)}
                        onCancel={(): void => cancel(ref)}
                      />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
