import type { ReactNode } from 'react';

type ChevronDirection = 'left' | 'right';

/** Which edge of the screen the panel sits on: it folds towards that edge. */
type PanelSide = 'left' | 'right';

interface CollapseToggleProps {
  /** Whether the panel is open now. */
  expanded: boolean;
  side: PanelSide;
  /** What the panel holds, used in the title and label: "Hide inspector" / "Show inspector". */
  label: string;
  onToggle: () => void;
}

export const Chevron = ({ direction }: { direction: ChevronDirection }): ReactNode => (
  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
    <path
      d={direction === 'left' ? 'M7.5 2.5 4 6l3.5 3.5' : 'M4.5 2.5 8 6l-3.5 3.5'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** The fold button of a side panel: the chevron points the way the panel will move. */
const chevronFor = (expanded: boolean, side: PanelSide): ChevronDirection =>
  expanded === (side === 'left') ? 'left' : 'right';

export const CollapseToggle = ({
  expanded,
  side,
  label,
  onToggle,
}: CollapseToggleProps): ReactNode => {
  const text: string = `${expanded ? 'Hide' : 'Show'} ${label}`;
  return (
    <button
      type="button"
      className="panel-toggle"
      onClick={onToggle}
      title={text}
      aria-label={text}
      aria-expanded={expanded}
    >
      <Chevron direction={chevronFor(expanded, side)} />
    </button>
  );
};
