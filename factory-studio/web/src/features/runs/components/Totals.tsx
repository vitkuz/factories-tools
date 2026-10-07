import type { ReactNode } from 'react';
import type { Overview } from '../runs.types';
import { formatTokens, formatUSD } from '../lib/format';

interface FigureProps {
  label: string;
  value: string;
  note?: string;
  accent?: boolean;
}

const Figure = ({ label, value, note, accent }: FigureProps): ReactNode => (
  <div className="figure">
    <span className={accent ? 'figure-value is-accent' : 'figure-value'}>{value}</span>
    <span className="figure-label">{label}</span>
    {note ? <span className="figure-note">{note}</span> : null}
  </div>
);

/** The five numbers above the tables. */
export const Totals = ({ overview }: { overview: Overview }): ReactNode => (
  <section className="totals" aria-label="Totals">
    <Figure label="pipelines" value={String(overview.totals.pipelines)} />
    <Figure label="runs" value={String(overview.totals.runs)} />
    <Figure label="steps" value={String(overview.totals.steps)} />
    <Figure
      label="cost"
      value={formatUSD(overview.totals.costUsd)}
      note={
        overview.totals.unpricedRuns > 0
          ? `${overview.totals.unpricedRuns} run${overview.totals.unpricedRuns === 1 ? '' : 's'} unpriced`
          : undefined
      }
      accent
    />
    <Figure label="tokens" value={formatTokens(overview.totals.totalTokens)} />
  </section>
);
