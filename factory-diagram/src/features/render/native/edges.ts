import type { Pill, Point, RoutedEdge } from './native.types.js';
import {
  PILL_FONT,
  PILL_GAP,
  PILL_H,
  arrowPoints,
  escapeXml,
  fmt,
  pillRowWidth,
  pillsFor,
  roundedPath,
} from './native.utils.js';

export interface EdgeOptions {
  /** `--hide max`: no `×N` on loop pills. */
  showMax: boolean;
}

/** The structural class an edge carries: what it is, before anything about a run. */
const edgeClass = (routed: RoutedEdge): string => {
  const { edge } = routed;
  return [
    'edge',
    `edge-${edge.kind}`,
    edge.results.includes('SKIP') ? 'edge-skip' : '',
    edge.happy ? 'edge-happy' : '',
  ]
    .filter(Boolean)
    .join(' ');
};

/** A row of pills centred on `at`: the canvas colour behind them cuts the line, as in the Studio. */
const pillRow = (at: Point, pills: readonly Pill[]): string => {
  if (pills.length === 0) return '';
  const total: number = pillRowWidth(pills);
  let x: number = at.x - total / 2;
  const parts: string[] = pills.map((pill: Pill): string => {
    const left: number = x;
    x += pill.width + PILL_GAP;
    return (
      `<g class="pill${pill.lit ? ' is-lit' : ''}">` +
      `<rect x="${fmt(left)}" y="${fmt(at.y - PILL_H / 2)}" width="${fmt(pill.width)}" height="${PILL_H}" rx="4"/>` +
      `<text x="${fmt(left + pill.width / 2)}" y="${fmt(at.y + PILL_FONT / 2 - 2)}" text-anchor="middle">${escapeXml(pill.text)}</text>` +
      `</g>`
    );
  });
  return `<g class="pills">${parts.join('')}</g>`;
};

/** The pills of an edge, as the renderer sizes them (the writer needs the width for the bounds). */
export const edgePills = (routed: RoutedEdge, options: EdgeOptions): Pill[] =>
  pillsFor(
    routed.edge.results,
    routed.edge.kind,
    routed.edge.max,
    routed.edge.happy,
    options.showMax,
  );

const edgeTitle = (routed: RoutedEdge): string => {
  const { edge } = routed;
  if (edge.kind === 'max') {
    return `${edge.source} → ${edge.target} when ${edge.event ?? 'the cap'} is spent (max ${edge.max ?? '?'})`;
  }
  const on: string = edge.results.length > 0 ? ` on ${edge.results.join(', ')}` : '';
  const cap: string = edge.max === null ? '' : ` (${edge.event} at most ${edge.max}×)`;
  return `${edge.source} → ${edge.target}${on}${cap}`;
};

/** One edge's line: the rounded orthogonal path and the arrowhead at the target. */
export const edgeSvg = (routed: RoutedEdge): string =>
  `<g class="${edgeClass(routed)}" data-edge="${escapeXml(routed.edge.id)}">` +
  `<title>${escapeXml(edgeTitle(routed))}</title>` +
  `<path class="edge-path" d="${roundedPath(routed.points)}"/>` +
  `<polygon class="edge-arrow" points="${arrowPoints(routed.to.point, routed.to.side)}"/>` +
  `</g>`;

/**
 * One edge's pills, drawn in a layer above every line — as the Studio's label renderer sits
 * above the edges — so a fan-out trunk never runs through a sibling's word.
 */
export const edgeLabelSvg = (routed: RoutedEdge, options: EdgeOptions): string => {
  const pills: Pill[] = edgePills(routed, options);
  return pills.length === 0
    ? ''
    : `<g class="${edgeClass(routed)}" data-edge-label="${escapeXml(routed.edge.id)}">` +
        pillRow(routed.label, pills) +
        `</g>`;
};
