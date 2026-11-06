import type { CSSProperties, ReactNode } from 'react';
import type { StepBreakdown, StepModelUsage, StepShare, StepUsageRow } from '../runs.types';
import { formatDurationMs, formatShare, formatTokens, formatUSD } from '../lib/format';
import { OTHER_ROW, modelFamily, stepSharesOf, stepsTimeSum } from '../runs-breakdown.utils';

interface StepBreakdownTableProps {
  runId: string;
  breakdown: StepBreakdown;
  /** The run's wall time, for the total line; `null` when the state has no times. */
  wallSeconds: number | null;
}

/** How the "other" line reads on the page; `OTHER_ROW` stays its key and its tooltip. */
const OTHER_LABEL = 'orchestrator (unattributed)';

const dash: ReactNode = <span className="is-absent">—</span>;

const seconds = (s: number | null): string | null =>
  s === null ? null : formatDurationMs(s * 1000);

const tokensCell = (row: StepUsageRow): ReactNode =>
  row.tokens === null ? dash : formatTokens(row.tokens);

const costCell = (row: StepUsageRow, priced: boolean): ReactNode => {
  if (row.costUsd === null) return priced ? dash : <span className="is-absent">unpriced</span>;
  if (row.costUsd === 'unpriced') return <span className="is-absent">unpriced</span>;
  return formatUSD(row.costUsd);
};

/** Agent time; a human gate shows its wait dimmed — it is not counted in the run's time. */
const timeCell = (row: StepUsageRow): ReactNode => {
  if (row.waitSeconds !== null)
    return (
      <span className="is-absent" title="Waiting for a person — not counted in the run's time">
        wait {seconds(row.waitSeconds)}
      </span>
    );
  return seconds(row.durationSeconds) ?? dash;
};

/** One line per model for the cell's tooltip: "claude-opus-5-5 · 1.2M tokens · $3.10". */
const modelLine = (m: StepModelUsage): string =>
  [
    m.model,
    m.tokens > 0 ? `${formatTokens(m.tokens)} tokens` : null,
    m.costUsd === null ? null : formatUSD(m.costUsd),
  ]
    .filter(Boolean)
    .join(' · ');

/**
 * "opus", or "opus+sonnet" for a row that used several models (most tokens first), with the
 * per-model tokens and money on hover; a dash when nothing was billed.
 */
const modelsCell = (row: StepUsageRow): ReactNode => {
  if (row.models.length === 0) return dash;
  const families: string[] = [
    ...new Set(row.models.map((m: StepModelUsage) => modelFamily(m.model))),
  ];
  return (
    <span className="mono" title={row.models.map(modelLine).join('\n')}>
      {families.join('+')}
    </span>
  );
};

/** "1", or "×2" in a warm pill for a step a loop sent back; a dash when it never started. */
const passesCell = (row: StepUsageRow): ReactNode => {
  if (row.passes === null) return dash;
  return row.passes > 1 ? <span className="passes-pill">×{row.passes}</span> : row.passes;
};

/** A step's own status, quietly, after its name; nothing for a completed step. */
const statusNote = (row: StepUsageRow): ReactNode =>
  row.status !== null && row.status !== 'COMPLETED' ? (
    <span className="cell-note">{row.status.toLowerCase()}</span>
  ) : null;

const ShareCell = ({ item }: { item: StepShare }): ReactNode => {
  const fill: CSSProperties = { width: `${item.barPct}%` };
  return (
    <span className="share">
      <span className="ri-track share-track" aria-hidden="true">
        <span className={`ri-fill ${item.hot ? 'is-hot' : 'is-tokens'}`} style={fill} />
      </span>
      <span className="share-pct">{item.share === null ? '' : formatShare(item.share)}</span>
    </span>
  );
};

/** "steps sum 46 min 25 s · wall 35 min 23 s": parallel steps overlap, so the two differ. */
const timesNote = (breakdown: StepBreakdown, wallSeconds: number | null): string =>
  [
    seconds(stepsTimeSum(breakdown)) === null
      ? null
      : `steps sum ${seconds(stepsTimeSum(breakdown))}`,
    seconds(wallSeconds) === null ? null : `running ${seconds(wallSeconds)} (human waits excluded)`,
  ]
    .filter(Boolean)
    .join(' · ');

/**
 * The run panel's table: one line per step in the order they started, the "other" line when
 * the report holds usage outside the steps, and the total — the same tokens and cost the run's
 * card shows, so the two always agree. Each line's money is also drawn as its share of the run.
 */
export const StepBreakdownTable = ({
  runId,
  breakdown,
  wallSeconds,
}: StepBreakdownTableProps): ReactNode => {
  const shares: StepShare[] = stepSharesOf(breakdown);
  return (
    <div className="steps-scroll">
      <table className="steps-table" aria-label={`Steps of ${runId}`}>
        <thead>
          <tr>
            <th>Step</th>
            <th className="is-center">Passes</th>
            <th>Model</th>
            <th className="steps-share-head">Share of cost</th>
            <th className="numeric">Cost</th>
            <th className="numeric">Tokens</th>
            <th className="numeric">Time</th>
          </tr>
        </thead>
        <tbody>
          {shares.map((item: StepShare) => {
            const other: boolean = item.row === breakdown.other;
            return (
              <tr
                key={item.row.step}
                className={[
                  item.hot ? 'is-hot' : '',
                  item.row.status === 'SKIPPED' ? 'is-skipped' : '',
                  other ? 'is-other' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <td className="steps-name">
                  {other ? (
                    <span
                      className="mono"
                      title={`${OTHER_ROW}: the orchestrator and unattributed calls`}
                    >
                      {OTHER_LABEL}
                    </span>
                  ) : (
                    <>
                      <span className="mono">{item.row.step}</span>
                      {statusNote(item.row)}
                    </>
                  )}
                </td>
                <td className="is-center">{passesCell(item.row)}</td>
                <td>{modelsCell(item.row)}</td>
                <td>
                  <ShareCell item={item} />
                </td>
                <td className="numeric mono is-money">{costCell(item.row, breakdown.priced)}</td>
                <td className="numeric mono">{tokensCell(item.row)}</td>
                <td className="numeric steps-time">{other ? dash : timeCell(item.row)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td className="is-center">{breakdown.total.passes ?? dash}</td>
            <td>{modelsCell(breakdown.total)}</td>
            <td className="steps-total-note">{timesNote(breakdown, wallSeconds)}</td>
            <td className="numeric mono is-money">{costCell(breakdown.total, breakdown.priced)}</td>
            <td className="numeric mono">{tokensCell(breakdown.total)}</td>
            <td className="numeric">{seconds(wallSeconds) ?? dash}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};
