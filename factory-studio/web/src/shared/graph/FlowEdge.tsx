import { memo, type CSSProperties } from 'react';
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { lastHeading, roundedPath, type Heading } from './route';
import type { EdgeData, GraphEdge, Point } from './graph.types';

const ARROW = 9;
const CORNER = 6;

/** A filled triangle at the tip, pointing the way the line arrives. */
const arrowPoints = (tip: Point, heading: Heading): string => {
  const h: number = ARROW / 2;
  switch (heading) {
    case 'down':
      return `${tip.x},${tip.y} ${tip.x - h},${tip.y - ARROW} ${tip.x + h},${tip.y - ARROW}`;
    case 'up':
      return `${tip.x},${tip.y} ${tip.x - h},${tip.y + ARROW} ${tip.x + h},${tip.y + ARROW}`;
    case 'left':
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

/**
 * The edge as the layout routed it: `data.points` is the polyline (drawn with rounded
 * corners), `data.label` where its pills sit. Without points (a graph laid out elsewhere)
 * it falls back to a straight line between the handles.
 */
function FlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  interactionWidth,
  data,
}: EdgeProps<GraphEdge>) {
  const d: EdgeData = data as EdgeData;
  const points: Point[] = d.points ?? [
    { x: sourceX, y: sourceY },
    { x: targetX, y: targetY },
  ];
  const path: string = roundedPath(points, CORNER);
  const tip: Point = points[points.length - 1];
  const label: Point = d.label ?? {
    x: (points[0].x + tip.x) / 2,
    y: (points[0].y + tip.y) / 2,
  };

  // A hushed edge (an untaken loop, escape or jump nobody is looking at) keeps its line, loses its label.
  const pills: Pill[] = d.hushed ? [] : pillsFor(d);
  const rowClass: string = [
    'edge-label',
    d.taken ? 'edge-label--taken' : '',
    d.taken && d.tone === 'skipped' ? 'edge-label--skipped' : '',
    d.loop ? 'edge-label--loop' : '',
    d.kind === 'max' ? 'edge-label--max' : '',
    d.labelMaxWidth !== undefined ? 'edge-label--wrap' : '',
    d.dimmed || d.bypassed ? 'edge-label--dimmed' : '',
    d.hidden ? 'edge-label--hidden' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const labelStyle: CSSProperties = {
    transform: `translate(-50%, -50%) translate(${label.x}px, ${label.y}px)`,
    ...(d.labelMaxWidth !== undefined ? { maxWidth: `${d.labelMaxWidth}px` } : {}),
  };

  return (
    <>
      <BaseEdge id={id} path={path} interactionWidth={interactionWidth} />
      <polygon className="edge-arrow" points={arrowPoints(tip, lastHeading(points))} />
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
