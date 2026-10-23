import type { ReactNode } from 'react';
import type { Overview } from '../runs.types';
import { formatTokens, formatUSD } from '../lib/format';

interface FigureProps {
  label: string;
  value: string;
  accent?: boolean;
}

const Figure = ({ label, value, accent }: FigureProps): ReactNode => (
  <div className="figure">
    <span className={accent ? 'figure-value is-accent' : 'figure-value'}>{value}</span>
    <span className="figure-label">{label}</span>
  </div>
);

/** "cost · 2 runs unpriced": an incomplete sum says so in its own label. */
const costLabel = (unpricedRuns: number): string =>
  unpricedRuns > 0 ? `cost · ${unpricedRuns} run${unpricedRuns === 1 ? '' : 's'} unpriced` : 'cost';

/** The five numbers over the two columns. */
export const Totals = ({ overview }: { overview: Overview }): ReactNode => (
  <section className="totals" aria-label="Totals">
    <Figure label="pipelines" value={String(overview.totals.pipelines)} />
    <Figure label="runs" value={String(overview.totals.runs)} />
    <Figure label="steps" value={String(overview.totals.steps)} />
    <Figure
      label={costLabel(overview.totals.unpricedRuns)}
      value={formatUSD(overview.totals.costUsd)}
      accent
    />
    <Figure label="tokens" value={formatTokens(overview.totals.totalTokens)} />
  </section>
);
