import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import type { RunOverview, RunScale } from '../runs.types';
import { barPercent, LONG_RUN_SECONDS, runScaleOf } from '../runs.utils';
import type { RunRef } from '../../../shared/lib/route';
import { formatDay, formatDurationMs, formatTokens, formatUSD } from '../lib/format';

interface RunCardsProps {
  /** Newest first, as the list has them. */
  runs: readonly RunOverview[];
  /** The run the panel beside shows. */
  selected: string | null;
  onSelect: (run: RunRef) => void;
  /** A double click opens the run's page. */
  onOpen: (run: RunRef) => void;
}

interface BarProps {
  label: string;
  pct: number;
  value: ReactNode;
  tone: 'money' | 'time' | 'long' | 'tokens';
}

/** One labelled bar of a card: the label, the track filled to `pct`, the figure. */
const Bar = ({ label, pct, value, tone }: BarProps): ReactNode => {
  const fill: CSSProperties = { width: `${pct}%` };
  return (
    <>
      <span className="run-card-label">{label}</span>
      <span className="ri-track run-card-track" aria-hidden="true">
        <span className={`ri-fill is-${tone}`} style={fill} />
      </span>
      <span className={`run-card-value is-${tone}`}>{value}</span>
    </>
  );
};

const absent = (text: string): ReactNode => <span className="is-absent">{text}</span>;

/**
 * The left column: one card per run of the picked pipeline, newest first — the name, the start
 * day, and cost, time and tokens as bars against the longest of each among these runs. A card
 * picks the run the panel beside shows; a double click opens the run.
 */
export const RunCards = ({ runs, selected, onSelect, onOpen }: RunCardsProps): ReactNode => {
  const scale: RunScale = runScaleOf(runs);
  return (
    <section className="panel run-cards" aria-label="Runs">
      <div className="panel-head">
        <h2 className="kicker">Runs</h2>
        <span className="panel-note">sorted by start</span>
      </div>
      <ul className="run-cards-list">
        {runs.map((run: RunOverview) => {
          const ref: RunRef = { pipelineId: run.pipelineId, runId: run.runId };
          const priced: boolean = run.priced && run.costUsd !== null;
          const long: boolean = (run.durationSeconds ?? 0) > LONG_RUN_SECONDS;
          const dot: CSSProperties = { background: `var(${run.statusToken})` };
          return (
            <li key={run.runId}>
              <button
                type="button"
                className="run-card"
                aria-pressed={run.runId === selected}
                title={`${run.runId} · ${run.status} — double-click to open`}
                onClick={(): void => onSelect(ref)}
                onDoubleClick={(event: MouseEvent<HTMLButtonElement>): void => {
                  event.preventDefault();
                  onOpen(ref);
                }}
              >
                <span className="run-card-head">
                  <span className="run-card-name">
                    <span className="status-dot" style={dot} aria-hidden="true" />
                    <span className="mono">{run.runId}</span>
                    <span className="visually-hidden">, {run.status}</span>
                  </span>
                  <span className="run-card-day">{formatDay(run.startedAt) || '—'}</span>
                </span>
                <span className="run-card-bars">
                  <Bar
                    label="Cost"
                    tone="money"
                    pct={barPercent(scale.costUsd)(priced ? run.costUsd : null)}
                    value={priced ? formatUSD(run.costUsd!) : absent('unpriced')}
                  />
                  <Bar
                    label="Time"
                    tone={long ? 'long' : 'time'}
                    pct={barPercent(scale.durationSeconds)(run.durationSeconds)}
                    value={
                      run.durationSeconds === null
                        ? absent('—')
                        : formatDurationMs(run.durationSeconds * 1000)
                    }
                  />
                  <Bar
                    label="Tokens"
                    tone="tokens"
                    pct={barPercent(scale.totalTokens)(run.totalTokens)}
                    value={run.totalTokens === null ? absent('—') : formatTokens(run.totalTokens)}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
