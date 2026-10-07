import type { CSSProperties, ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';
import { HANDLE } from './layout';

const HANDLE_LEFT: CSSProperties = { left: '20%' };
const HANDLE_RIGHT: CSSProperties = { left: '80%' };

/**
 * The eight invisible handles of a step card, one per edge direction: row edges leave right
 * and enter left, loops leave and enter at the bottom, escapes and jumps at the top.
 */
export const StepHandles = (): ReactNode => (
  <>
    <Handle type="target" position={Position.Left} id={HANDLE.in} className="rf-handle" />
    <Handle type="source" position={Position.Right} id={HANDLE.out} className="rf-handle" />
    <Handle
      type="source"
      position={Position.Bottom}
      id={HANDLE.loopOut}
      className="rf-handle"
      style={HANDLE_LEFT}
    />
    <Handle
      type="target"
      position={Position.Bottom}
      id={HANDLE.loopIn}
      className="rf-handle"
      style={HANDLE_RIGHT}
    />
    <Handle
      type="source"
      position={Position.Top}
      id={HANDLE.maxOut}
      className="rf-handle"
      style={HANDLE_RIGHT}
    />
    <Handle
      type="target"
      position={Position.Top}
      id={HANDLE.maxIn}
      className="rf-handle"
      style={HANDLE_LEFT}
    />
    <Handle type="source" position={Position.Top} id={HANDLE.jumpOut} className="rf-handle" />
    <Handle type="target" position={Position.Top} id={HANDLE.jumpIn} className="rf-handle" />
  </>
);

export interface StepCardProps {
  /** The slug line — plain text, or the editor's rename field. */
  slug: ReactNode;
  /** Right end of the head line: the Runs screen's status dot, the editor's issue badge. */
  headEnd?: ReactNode;
  agent: string;
  /** Model line; a human card prints "waits for a person" instead. */
  model: string | null;
  modelTitle?: string;
  human: boolean;
  detailed: boolean;
  /** Extra classes on the card (`is-selected`, …). */
  className?: string;
  /** The Runs screen's step status, for the CSS that keys on it. */
  status?: string;
  /** What follows the model line: a duration line, the doc groups, the footer. */
  children?: ReactNode;
}

/** The fixed-size step card both screens draw: handles, head, agent, model, then whatever the screen adds. */
export const StepCard = ({
  slug,
  headEnd,
  agent,
  model,
  modelTitle,
  human,
  detailed,
  className,
  status,
  children,
}: StepCardProps): ReactNode => (
  <div
    className={[
      'step-node',
      detailed ? 'is-detailed' : '',
      human ? 'is-human' : '',
      className ?? '',
    ]
      .filter(Boolean)
      .join(' ')}
    data-status={status}
  >
    <StepHandles />
    <div className="step-head">
      <span className="step-slug">{slug}</span>
      {headEnd}
    </div>
    <div className="step-agent">{agent}</div>
    <div className="step-model" title={modelTitle}>
      {human ? 'waits for a person' : model}
    </div>
    {children}
  </div>
);
