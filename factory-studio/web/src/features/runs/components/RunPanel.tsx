import { useCallback, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import type { RemoveRunOutcome, RunOverview, StepBreakdown } from '../runs.types';
import { buildPath, type RunRef } from '../../../shared/lib/route';
import { formatDay, formatDurationMs, formatTokens, formatUSD } from '../lib/format';
import { RemoveRunButton, RemoveRunConfirm } from './RemoveRun';
import { StepBreakdownTable } from './StepBreakdownTable';

interface RunPanelProps {
  run: RunOverview;
  /** The run's per-step rows, read from the record on every push; `null` when there are none. */
  breakdown: StepBreakdown | null;
  onOpen: (run: RunRef) => void;
  /** Moves the run to `run/.trash`; without it there is no bin. */
  onRemove?: (run: RunRef) => Promise<RemoveRunOutcome>;
}

/** The confirm under the head, while open. */
interface Confirming {
  runId: string;
  busy: boolean;
  error: string | null;
}

const REMOVE_BUTTON_ID = 'run-panel-remove';

/** A plain left click opens in place; a modified one falls through to the browser (new tab). */
const isPlainClick = (event: MouseEvent<HTMLAnchorElement>): boolean =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

const Cell = ({
  label,
  value,
  money,
}: {
  label: string;
  value: ReactNode;
  money?: boolean;
}): ReactNode => (
  <div className="ri-stat ri-stat--run">
    <span className="ri-stat-label">{label}</span>
    <span className={money ? 'ri-stat-value is-money' : 'ri-stat-value'}>{value}</span>
  </div>
);

const absent = (text: string): ReactNode => <span className="is-absent">{text}</span>;

/**
 * The right column: the picked run — its name (a link to its page), status and start day, Open
 * and the bin, its four figures, then its steps with their share of the money. The bin opens a
 * confirm under the head; the run moves to `run/.trash` only from there.
 */
export const RunPanel = ({ run, breakdown, onOpen, onRemove }: RunPanelProps): ReactNode => {
  const ref: RunRef = { pipelineId: run.pipelineId, runId: run.runId };
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const open: Confirming | null = confirming?.runId === run.runId ? confirming : null;
  const statusColor: CSSProperties | undefined = run.hasState
    ? { color: `var(${run.statusToken})` }
    : undefined;
  const dot: CSSProperties = { background: `var(${run.statusToken})` };
  const day: string = formatDay(run.startedAt);

  const cancel = useCallback((): void => {
    setConfirming(null);
    // Back to the bin it came from, so the keyboard does not lose its place.
    document.getElementById(REMOVE_BUTTON_ID)?.focus();
  }, []);

  const confirm = useCallback(async (): Promise<void> => {
    if (!onRemove) return;
    const runId: string = run.runId;
    setConfirming({ runId, busy: true, error: null });
    const outcome: RemoveRunOutcome = await onRemove({ pipelineId: run.pipelineId, runId });
    setConfirming((now: Confirming | null): Confirming | null =>
      now?.runId !== runId
        ? now
        : outcome.ok
          ? null
          : { runId, busy: false, error: outcome.message },
    );
  }, [onRemove, run.pipelineId, run.runId]);

  return (
    <section id="run-panel" className="panel run-panel" aria-label={`Run ${run.runId}`}>
      <div className="panel-intro run-panel-head">
        <div className="panel-intro-title">
          <span className="kicker">Run</span>
          <h2 className="panel-name">
            <a
              href={buildPath({ screen: 'runs', run: ref })}
              title="Open the run"
              onClick={(event: MouseEvent<HTMLAnchorElement>): void => {
                if (!isPlainClick(event)) return;
                event.preventDefault();
                onOpen(ref);
              }}
            >
              {run.runId}
            </a>
          </h2>
        </div>
        <div className="run-panel-side">
          <span className="run-panel-status" style={statusColor}>
            <span className="status-dot" style={dot} aria-hidden="true" />
            {run.status}
            {day ? ` · ${day}` : ''}
          </span>
          {run.stepsSkipped > 0 ? (
            <span className="chip chip--skipped">{run.stepsSkipped} skipped</span>
          ) : null}
          <span className="run-panel-actions">
            <button type="button" className="btn" onClick={(): void => onOpen(ref)}>
              Open run
            </button>
            {onRemove ? (
              <RemoveRunButton
                runId={run.runId}
                id={REMOVE_BUTTON_ID}
                open={open !== null}
                onOpen={(): void =>
                  open ? cancel() : setConfirming({ runId: run.runId, busy: false, error: null })
                }
              />
            ) : null}
          </span>
        </div>
      </div>
      {open ? (
        <div className="run-panel-confirm">
          <RemoveRunConfirm
            runId={run.runId}
            pipelineId={run.pipelineId}
            active={run.active}
            busy={open.busy}
            error={open.error}
            onConfirm={(): void => void confirm()}
            onCancel={cancel}
          />
        </div>
      ) : null}
      <div className="ri-stats ri-stats--run">
        <Cell
          label="Time"
          value={
            run.durationSeconds === null
              ? absent('—')
              : formatDurationMs(run.durationSeconds * 1000)
          }
        />
        <Cell
          label="Tokens"
          value={run.totalTokens === null ? absent('—') : formatTokens(run.totalTokens)}
        />
        <Cell
          label="Cost"
          money={run.priced && run.costUsd !== null}
          value={run.priced && run.costUsd !== null ? formatUSD(run.costUsd) : absent('unpriced')}
        />
        <Cell
          label="Passes"
          value={
            breakdown?.total.passes === null || !breakdown ? absent('—') : breakdown.total.passes
          }
        />
      </div>
      {breakdown && breakdown.steps.length + (breakdown.other ? 1 : 0) > 0 ? (
        <StepBreakdownTable
          runId={run.runId}
          breakdown={breakdown}
          wallSeconds={run.durationSeconds}
        />
      ) : (
        <p className="panel-empty">No step data for this run.</p>
      )}
    </section>
  );
};
