import { memo, type CSSProperties } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Position,
  type EdgeProps,
} from '@xyflow/react';
import { LANE_ABOVE, LANE_BELOW } from './layout';
import type { EdgeData, GraphEdge } from './graph.types';

const ARROW = 9;

interface Point {
  x: number;
  y: number;
}

/** A filled triangle at the target end, pointing along the arriving direction. */
const arrowPoints = (tip: Point, position: Position): string => {
  const h: number = ARROW / 2;
  switch (position) {
    case Position.Top:
      return `${tip.x},${tip.y} ${tip.x - h},${tip.y - ARROW} ${tip.x + h},${tip.y - ARROW}`;
    case Position.Bottom:
      return `${tip.x},${tip.y} ${tip.x - h},${tip.y + ARROW} ${tip.x + h},${tip.y + ARROW}`;
    case Position.Right:
      return `${tip.x},${tip.y} ${tip.x + ARROW},${tip.y - h} ${tip.x + ARROW},${tip.y + h}`;
    default:
      return `${tip.x},${tip.y} ${tip.x - ARROW},${tip.y - h} ${tip.x - ARROW},${tip.y + h}`;
  }
};

interface Pill {
  text: string;
  /** This result was travelled — lit in the edge's taken tone. */
  lit: boolean;
  /** Another result on the same edge was travelled and this one was not — muted. */
  muted: boolean;
  /** Loop / escape traversal count shown after the text. */
  count: number | null;
}

/** One pill per result, side by side; only the travelled results light up. */
const pillsFor = (data: EdgeData): Pill[] => {
  if (data.kind === 'start') return [];
  // Loops and escapes count from one (a loop that ran once is news); forward routes only when repeated.
  const countsFromOne: boolean = data.loop || data.kind === 'max';
  const showCount: number | null = countsFromOne
    ? data.traversals > 0
      ? data.traversals
      : null
    : data.traversals > 1
      ? data.traversals
      : null;
  const results: string[] = data.kind === 'max' ? ['max'] : data.results;
  return results.map((r: string, i: number): Pill => {
    const lit: boolean = data.kind === 'max' ? data.taken : data.takenResults.includes(r);
    return { text: r, lit, muted: data.taken && !lit, count: i === 0 ? showCount : null };
  });
};

function FlowEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  interactionWidth,
  data,
}: EdgeProps<GraphEdge>) {
  const d: EdgeData = data as EdgeData;
  const above: boolean = d.lane === 'above';
  const below: boolean = d.lane === 'below';

  // Lane edges get the offset that puts their horizontal segment on the allocated lane y.
  const offset: number = above
    ? d.laneY !== undefined
      ? Math.max(16, Math.min(sourceY, targetY) - d.laneY)
      : LANE_ABOVE
    : below
      ? d.laneY !== undefined
        ? Math.max(16, d.laneY - Math.max(sourceY, targetY))
        : LANE_BELOW
      : 20;

  const [path, midX, midY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 6,
    offset,
  });

  // Lane labels sit on the horizontal segment (the canvas colour behind them cuts the line).
  const laneY: number = above
    ? Math.min(sourceY, targetY) - offset
    : Math.max(sourceY, targetY) + offset;
  const label: Point =
    above || below ? { x: (sourceX + targetX) / 2, y: laneY } : { x: midX, y: midY };

  const pills: Pill[] = pillsFor(d);
  const rowClass: string = [
    'edge-label',
    d.taken ? 'edge-label--taken' : '',
    d.taken && d.tone === 'skipped' ? 'edge-label--skipped' : '',
    d.loop ? 'edge-label--loop' : '',
    d.kind === 'max' ? 'edge-label--max' : '',
    d.dimmed || d.bypassed ? 'edge-label--dimmed' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const labelStyle: CSSProperties = {
    transform: `translate(-50%, -50%) translate(${label.x}px, ${label.y}px)`,
  };

  return (
    <>
      <BaseEdge id={id} path={path} interactionWidth={interactionWidth} />
      <polygon
        className="edge-arrow"
        points={arrowPoints({ x: targetX, y: targetY }, targetPosition)}
      />
      {d.live && <path className="edge-flow-overlay" d={path} fill="none" />}
      {pills.length > 0 && (
        <EdgeLabelRenderer>
          <div className={rowClass} style={labelStyle} data-edge-label={id}>
            {pills.map((p: Pill) => (
              <span
                key={p.text}
                className={`edge-pill${p.lit ? ' is-lit' : ''}${p.muted ? ' is-muted' : ''}`}
              >
                {d.loop && <span className="edge-glyph">↺ </span>}
                {p.text}
                {p.count != null && <span className="edge-count"> ×{p.count}</span>}
              </span>
            ))}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default memo(FlowEdge);
