import type { KeyboardEvent, ReactNode } from 'react';
import { RUN_TABS, type RunTab } from '../../../shared/lib/route';

interface RunTabsProps {
  tab: RunTab;
  onTab: (tab: RunTab) => void;
}

const LABEL: Record<RunTab, string> = { graph: 'Graph', timeline: 'Timeline' };

const HINT: Record<RunTab, string> = {
  graph: 'The pipeline as a graph, with the route the run took',
  timeline: 'Every step in the order the run reached it, with its timing and files',
};

/** The next tab for an arrow key (wrapping), or null for any other key. */
const stepTab = (tab: RunTab, key: string): RunTab | null => {
  const i: number = RUN_TABS.indexOf(tab);
  if (key === 'ArrowRight') return RUN_TABS[(i + 1) % RUN_TABS.length];
  if (key === 'ArrowLeft') return RUN_TABS[(i - 1 + RUN_TABS.length) % RUN_TABS.length];
  return null;
};

/** The run page's tab bar over the main area: Graph and Timeline (arrow keys move between them). */
export const RunTabs = ({ tab, onTab }: RunTabsProps): ReactNode => {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const next: RunTab | null = stepTab(tab, e.key);
    if (next === null) return;
    e.preventDefault();
    onTab(next);
    document.getElementById(`run-tab-${next}`)?.focus();
  };
  return (
    <div className="run-tabs" role="tablist" aria-label="Run view" onKeyDown={onKeyDown}>
      {RUN_TABS.map((t: RunTab) => (
        <button
          key={t}
          id={`run-tab-${t}`}
          type="button"
          role="tab"
          className="run-tab"
          aria-selected={t === tab}
          aria-controls={`run-panel-${t}`}
          tabIndex={t === tab ? 0 : -1}
          title={HINT[t]}
          onClick={() => onTab(t)}
        >
          {LABEL[t]}
        </button>
      ))}
    </div>
  );
};
