import type { CSSProperties } from 'react';
import { STATUS_META, type StepStatusKey } from '../lib/graph';

interface Props {
  /** Text shown in the badge. */
  label: string;
  /** CSS custom property carrying the colour, e.g. `--st-completed`. */
  token: string;
  ariaLabel?: string;
}

/** A quiet status badge: colour is the only chroma, and it always means a status. */
export function Badge({ label, token, ariaLabel }: Props) {
  const style: CSSProperties = { ['--badge' as string]: `var(${token})` };
  return (
    <span className="status-badge" style={style} aria-label={ariaLabel ?? `status: ${label}`}>
      <span className="status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export default function StatusBadge({ status }: { status: StepStatusKey }) {
  return <Badge label={STATUS_META[status].label} token={STATUS_META[status].token} />;
}
