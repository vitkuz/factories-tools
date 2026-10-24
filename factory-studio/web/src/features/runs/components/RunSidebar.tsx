import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type { DayGroup, RunFilter, RunRecord } from '../runs.types';
import { displayRunId, groupByDay, matchesFilter, matchesQuery } from '../runs.utils';
import { formatUSD } from '../lib/format';
import { runStatusWord } from '../lib/run';
import { runStatusToken } from './RunMeta';
import { buildPath, type RunRef } from '../../../shared/lib/route';
import { readJson, writeJson } from '../../../shared/lib/storage';
import { useNow } from '../../../shared/lib/polling';
import { CollapseToggle } from '../../../shared/components/CollapseToggle';
import { BrandMark } from '../../../shared/components/BrandMark';

const STORAGE_KEY = 'studio.runs.sidebar';
const BRAND_LEAD = 'FACTORY';
const BRAND_TAG = 'STUDIO';
const BRAND_NAME = `${BRAND_LEAD} ${BRAND_TAG}`;

interface SidebarPrefs {
  collapsed: boolean;
}

interface FilterChip {
  id: RunFilter;
  label: string;
}

const FILTERS: FilterChip[] = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
];

interface RunSidebarProps {
  runs: RunRecord[];
  /** The chosen workspace's name, shown by the title; `null` for All. */
  workspaceName?: string | null;
  /** The run on screen — its row is marked and kept in view; `null` on the index and on Sessions. */
  current: RunRef | null;
  onChoose: (ref: RunRef) => void;
}

const readPrefs = (): SidebarPrefs => readJson<SidebarPrefs>(STORAGE_KEY, { collapsed: false });

/** A plain left click; modified clicks fall through to the browser (new tab). */
const isPlainClick = (event: MouseEvent<HTMLAnchorElement>): boolean =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

const sameRun = (a: RunRef, b: RunRef): boolean =>
  a.pipelineId === b.pipelineId && a.runId === b.runId;

/** One run: status dot and id on the first line; pipeline, status word and cost on the second. */
const RunRow = ({
  run,
  active,
  onChoose,
}: {
  run: RunRecord;
  active: boolean;
  onChoose: (ref: RunRef) => void;
}): ReactNode => {
  const ref: RunRef = { pipelineId: run.pipelineId, runId: run.runId };
  const token: string = runStatusToken(run);
  const dotStyle: CSSProperties = { background: `var(${token})` };
  // A completed run reads quietly, as the reference draws it; every other status keeps its colour.
  const wordStyle: CSSProperties | undefined =
    run.state?.status === 'COMPLETED' ? undefined : { color: `var(${token})` };
  return (
    <li>
      <a
        href={buildPath({ screen: 'runs', run: ref })}
        className="run-row"
        aria-current={active ? 'page' : undefined}
        title={`${run.pipelineId}/${run.runId}`}
        onClick={(event: MouseEvent<HTMLAnchorElement>): void => {
          if (!isPlainClick(event)) return;
          event.preventDefault();
          onChoose(ref);
        }}
      >
        <span className="run-row-line">
          <span className="status-dot" style={dotStyle} aria-hidden="true" />
          <span className="run-row-id">{displayRunId(run.runId)}</span>
        </span>
        <span className="run-row-meta mono">
          <span className="run-row-pipeline">{run.pipelineId}</span>
          <span className="run-row-status" style={wordStyle}>
            {runStatusWord(run.state?.status)}
          </span>
          {run.cost && (
            <span className="run-row-cost">{formatUSD(run.cost.totals.estimatedListPriceUsd)}</span>
          )}
        </span>
      </a>
    </li>
  );
};

/** The wordmark at the top of the sidebar: the favicon mark, the house name, the tool's word in a tile. */
const Brand = (): ReactNode => (
  <h1 className="brand">
    <BrandMark />
    <span className="brand-lead">{BRAND_LEAD}</span>
    <span className="brand-tag">{BRAND_TAG}</span>
  </h1>
);

/**
 * The sidebar down the left edge of the app: the brand on top, then a search box, status
 * chips and every run grouped by its start day, the one on screen marked. Rows are links, so
 * Tab, Enter and a middle click work as links do; ArrowUp/ArrowDown move between rows. `‹`
 * folds it to a rail that keeps the mark and the button that brings it back, remembered in
 * localStorage.
 */
export const RunSidebar = ({
  runs,
  workspaceName = null,
  current,
  onChoose,
}: RunSidebarProps): ReactNode => {
  const now: number = useNow(60_000);
  const [collapsed, setCollapsed] = useState<boolean>(() => readPrefs().collapsed);
  const [query, setQuery] = useState<string>('');
  const [filter, setFilter] = useState<RunFilter>('all');
  const listRef = useRef<HTMLElement | null>(null);

  const shown: RunRecord[] = useMemo(
    (): RunRecord[] => runs.filter(matchesFilter(filter)).filter(matchesQuery(query)),
    [runs, filter, query],
  );
  const groups: DayGroup[] = useMemo((): DayGroup[] => groupByDay(shown, now), [shown, now]);

  const toggle = (): void => {
    const next: boolean = !collapsed;
    setCollapsed(next);
    writeJson(STORAGE_KEY, { collapsed: next });
  };

  // The current row is brought into view when the run changes, never on a poll.
  const currentKey: string | null = current ? `${current.pipelineId}/${current.runId}` : null;
  useEffect(() => {
    if (collapsed || currentKey === null) return;
    listRef.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [currentKey, collapsed]);

  const onListKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows: HTMLAnchorElement[] = Array.from(
      listRef.current?.querySelectorAll<HTMLAnchorElement>('a.run-row') ?? [],
    );
    if (rows.length === 0) return;
    event.preventDefault();
    const index: number = rows.findIndex(
      (row: HTMLAnchorElement) => row === document.activeElement,
    );
    const delta: number = event.key === 'ArrowDown' ? 1 : -1;
    const next: number = index < 0 ? 0 : (index + delta + rows.length) % rows.length;
    rows[next].focus();
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape' && query !== '') {
      event.preventDefault();
      setQuery('');
    }
  };

  if (collapsed) {
    return (
      <div className="runs-rail is-app">
        <div className="rail-brand" title={BRAND_NAME} aria-label={BRAND_NAME} role="img">
          <BrandMark />
        </div>
        <CollapseToggle expanded={false} side="left" label="runs" onToggle={toggle} />
      </div>
    );
  }

  return (
    <aside className="runs-sidebar" aria-label="Runs">
      <div className="sidebar-brand">
        <Brand />
        <CollapseToggle expanded={true} side="left" label="runs" onToggle={toggle} />
      </div>
      <div className="runs-sidebar-head">
        <div className="runs-sidebar-title-row">
          <h2 className="runs-sidebar-title">Latest runs</h2>
          {workspaceName !== null ? (
            <span className="runs-sidebar-workspace muted" title={`Workspace ${workspaceName}`}>
              {workspaceName}
            </span>
          ) : null}
          <span className="runs-sidebar-count mono" aria-label={`${shown.length} runs shown`}>
            {shown.length}
          </span>
        </div>
        <input
          type="text"
          className="runs-search"
          placeholder="Search runs"
          aria-label="Search runs"
          value={query}
          onChange={(event: ChangeEvent<HTMLInputElement>): void => setQuery(event.target.value)}
          onKeyDown={onSearchKeyDown}
        />
        <div className="runs-filters" role="group" aria-label="Filter by status">
          {FILTERS.map((chip: FilterChip) => (
            <button
              key={chip.id}
              type="button"
              className="runs-filter"
              aria-pressed={filter === chip.id}
              onClick={(): void => setFilter(chip.id)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>
      <nav
        className="runs-sidebar-list"
        aria-label="Run list"
        ref={listRef}
        onKeyDown={onListKeyDown}
      >
        {groups.map((group: DayGroup) => (
          <section key={group.label} className="runs-day" aria-label={group.label}>
            <h3 className="runs-day-label mono">{group.label}</h3>
            <ul className="runs-day-rows">
              {group.runs.map((run: RunRecord) => (
                <RunRow
                  key={`${run.pipelineId}/${run.runId}`}
                  run={run}
                  active={
                    current !== null &&
                    sameRun(current, { pipelineId: run.pipelineId, runId: run.runId })
                  }
                  onChoose={onChoose}
                />
              ))}
            </ul>
          </section>
        ))}
        {shown.length === 0 && (
          <p className="runs-empty muted">
            {runs.length === 0
              ? workspaceName !== null
                ? 'No runs in this workspace.'
                : 'No runs yet.'
              : 'No runs match.'}
          </p>
        )}
      </nav>
    </aside>
  );
};
