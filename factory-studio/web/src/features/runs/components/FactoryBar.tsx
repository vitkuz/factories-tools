import type { ChangeEvent, ReactNode } from 'react';
import type { DashboardData, Overview, PipelineOverview } from '../runs.types';
import { formatTokens, formatUSD } from '../lib/format';
import { WorkspacePicker } from '../../workspaces';

interface FactoryBarProps {
  /** The whole run list: the workspace dialog offers every factory in it. */
  allData: DashboardData;
  /** The workspace's overview, for the sums at the end of the bar; `null` while there is none. */
  overview: Overview | null;
  /** Already sorted by last run. */
  pipelines: readonly PipelineOverview[];
  selected: string | null;
  onSelect: (pipelineId: string) => void;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "9 pipelines · 40 runs · $340.96 · 641.5M tokens", with the unpriced runs said, not hidden. */
const totalsLine = (overview: Overview): string =>
  [
    plural(overview.totals.pipelines, 'pipeline'),
    plural(overview.totals.runs, 'run'),
    `${formatUSD(overview.totals.costUsd)}${
      overview.totals.unpricedRuns > 0 ? ` (${overview.totals.unpricedRuns} unpriced)` : ''
    }`,
    `${formatTokens(overview.totals.totalTokens)} tokens`,
  ].join(' · ');

/**
 * The bar over the Runs home: the factory (workspace) picker and Manage, the pipeline whose
 * runs the page shows (newest last run first; the pick is remembered), and the sums over
 * everything the chosen factory sees.
 */
export const FactoryBar = ({
  allData,
  overview,
  pipelines,
  selected,
  onSelect,
}: FactoryBarProps): ReactNode => (
  <section className="bar factory-bar" aria-label="Factory">
    <WorkspacePicker data={allData} label="Factory" className="workspace-picker--bar" />
    {pipelines.length > 0 ? (
      <>
        <span className="bar-rule" aria-hidden="true" />
        <label className="bar-field">
          <span className="kicker">Pipeline</span>
          <select
            className="control is-mono"
            value={selected ?? ''}
            onChange={(event: ChangeEvent<HTMLSelectElement>): void => onSelect(event.target.value)}
          >
            {pipelines.map((pipeline: PipelineOverview) => (
              <option key={pipeline.pipelineId} value={pipeline.pipelineId}>
                {pipeline.pipelineId}
              </option>
            ))}
          </select>
        </label>
      </>
    ) : null}
    <span className="bar-fill" />
    {overview && overview.totals.runs > 0 ? (
      <span className="bar-note" title="Every run the chosen factory sees">
        {totalsLine(overview)}
      </span>
    ) : null}
  </section>
);
