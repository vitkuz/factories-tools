import type { CSSProperties } from 'react';
import { STATUS_META, type StepStatusKey, type ViewMode } from '../lib/graph';

interface Props {
  /** Statuses present in the current run, in display order. */
  statuses: StepStatusKey[];
  view: ViewMode;
  onToggleView: () => void;
}

/** Bottom-left canvas strip: the status legend and the Details toggle, one row. */
export default function Legend({ statuses, view, onToggleView }: Props) {
  const detailed: boolean = view === 'detailed';
  return (
    <div className="canvas-strip">
      {statuses.length > 0 && (
        <ul className="legend" aria-label="Step status legend">
          {statuses.map((key: StepStatusKey) => {
            const style: CSSProperties = { background: `var(${STATUS_META[key].token})` };
            return (
              <li key={key} className="legend-item">
                <span className="status-dot" style={style} aria-hidden="true" />
                {STATUS_META[key].label}
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        className="details-toggle"
        aria-pressed={detailed}
        onClick={onToggleView}
        title={
          detailed ? 'Show compact cards (d)' : 'Show duration and documents on every card (d)'
        }
      >
        Details
      </button>
    </div>
  );
}
