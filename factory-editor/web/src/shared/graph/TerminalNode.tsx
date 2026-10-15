import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { HANDLE } from './layout';
import type { TerminalNodeType } from './graph.types';

export const StartNode = memo(function StartNode({ data }: NodeProps<TerminalNodeType>) {
  return (
    <div className="terminal-node start-node">
      {data.label}
      <Handle type="source" position={Position.Right} id={HANDLE.out} className="rf-handle" />
    </div>
  );
});

export const EndNode = memo(function EndNode({ data }: NodeProps<TerminalNodeType>) {
  return (
    <div className="terminal-node end-node">
      <Handle type="target" position={Position.Left} id={HANDLE.in} className="rf-handle" />
      {data.label}
    </div>
  );
});
