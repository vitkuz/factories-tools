import type { GraphModel, GraphNode } from '../../graph/index.js';
import type { RenderOptions } from '../render.types.js';
import { nodeSvg, type CardOptions } from './cards.js';
import { edgeLabelSvg, edgePills, edgeSvg, type EdgeOptions } from './edges.js';
import { LEGEND_H, legendSvg, legendWidth } from './legend.js';
import type { NativeLayout } from './layout.service.js';
import type { Bounds, Box, Pill, PlacedNode, Point, RoutedEdge } from './native.types.js';
import {
  ARROW,
  PILL_H,
  boundsToBox,
  emptyBounds,
  escapeXml,
  fmt,
  includeBox,
  includePoint,
  pillRowWidth,
} from './native.utils.js';
import type { ThemeTokens } from './themes.js';
import { TITLE_H, titleSvg, titleWidth } from './title.js';

const MARGIN = 24;
/** Between the title block and the graph, and between the graph and the legend. */
const BLOCK_GAP = 20;

const FONT_STACK = "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/**
 * Every colour comes from the theme object; every shape keys on a class. The values are baked
 * into the rules rather than exposed as CSS custom properties: resvg (the M5 PNG path), librsvg
 * and Inkscape do not resolve those, browsers alone do.
 */
const styleBlock = (t: ThemeTokens): string =>
  `<style>` +
  `svg { font-family: ${FONT_STACK}; }` +
  `.canvas { fill: ${t.canvas}; }` +
  `.card-box { fill: ${t.card}; stroke: ${t.cardBorder}; stroke-width: 2; }` +
  `.is-human .card-box { stroke: ${t.human}; stroke-dasharray: 4 3; }` +
  `.is-unreachable .card-box { stroke: ${t.warn}; }` +
  `.is-highlight .card-box { stroke: ${t.highlight}; stroke-width: 3; }` +
  `.card-slug { font-size: 14px; font-weight: 600; fill: ${t.ink}; }` +
  `.card-agent { font-size: 12px; fill: ${t.agent}; }` +
  `.card-model { font-size: 12px; fill: ${t.ink2}; font-style: italic; }` +
  `.card-waits { font-size: 12px; fill: ${t.human}; }` +
  `.gate-glyph { fill: ${t.human}; }` +
  `.warn-badge path { fill: ${t.warn}; }` +
  `.warn-badge text { font-size: 9px; font-weight: 700; fill: ${t.canvas}; text-anchor: middle; }` +
  `.chip rect { fill-opacity: 0.14; }` +
  `.chip-text { font-size: 11px; font-weight: 600; }` +
  `.chip-fable rect, .chip-fable text { fill: ${t.modelFable}; }` +
  `.chip-opus rect, .chip-opus text { fill: ${t.modelOpus}; }` +
  `.chip-sonnet rect, .chip-sonnet text { fill: ${t.modelSonnet}; }` +
  `.chip-haiku rect, .chip-haiku text { fill: ${t.modelHaiku}; }` +
  `.chip-other rect, .chip-other text { fill: ${t.modelOther}; }` +
  `.terminal rect { fill: ${t.card}; stroke: ${t.cardBorder}; stroke-width: 1.5; }` +
  `.terminal-text { font-size: 12px; font-weight: 500; fill: ${t.ink2}; }` +
  `.edge-path { fill: none; stroke: ${t.edge}; stroke-width: 1.5; }` +
  `.edge-arrow { fill: ${t.edge}; }` +
  `.edge-loop .edge-path, .edge-max .edge-path, .edge-jump .edge-path, .edge-skip .edge-path { stroke-dasharray: 5 5; }` +
  `.edge-happy .edge-path { stroke: ${t.edgeHappy}; stroke-width: 2.5; }` +
  `.edge-happy .edge-arrow { fill: ${t.edgeHappy}; }` +
  `.pill rect { fill: ${t.canvas}; }` +
  `.pill text { font-size: 12px; fill: ${t.ink2}; }` +
  `.pill.is-lit text { fill: ${t.edgeHappy}; font-weight: 600; }` +
  `.legend-text { font-size: 11px; fill: ${t.ink2}; }` +
  `.title-name { font-size: 16px; font-weight: 600; fill: ${t.ink}; }` +
  `.title-meta { font-size: 12px; fill: ${t.ink2}; }` +
  `</style>`;

/** Everything the picture touches in flow space: cards, edge corners, arrowheads, pills. */
const graphBounds = (layout: NativeLayout, edgeOptions: EdgeOptions): Box => {
  const withNodes: Bounds = layout.nodes.reduce(
    (b: Bounds, n: PlacedNode): Bounds => includeBox(b, n.box),
    emptyBounds(),
  );
  const withEdges: Bounds = layout.edges.reduce((b: Bounds, e: RoutedEdge): Bounds => {
    const pills: Pill[] = edgePills(e, edgeOptions);
    const half: number = pillRowWidth(pills) / 2;
    const withPoints: Bounds = e.points.reduce(
      (inner: Bounds, p: Point): Bounds => includePoint(inner, p, ARROW),
      b,
    );
    return pills.length === 0
      ? withPoints
      : includeBox(withPoints, {
          x: e.label.x - half,
          y: e.label.y - PILL_H / 2,
          width: 2 * half,
          height: PILL_H,
        });
  }, withNodes);
  return boundsToBox(withEdges);
};

const hoverTitle = (node: GraphNode): string =>
  [node.id, node.agent ?? '', node.model ?? (node.kind === 'human' ? 'waits for a person' : '')]
    .filter(Boolean)
    .join(' · ');

export interface WriterInput {
  model: GraphModel;
  layout: NativeLayout;
  tokens: ThemeTokens;
  options: RenderOptions;
}

/**
 * The document: title block, the graph translated so its top-left lands under the title,
 * the legend under the graph. Deterministic: same model, same bytes — the generator comment
 * carries the version and the source path, never a date.
 */
export const writeSvg = ({ model, layout, tokens, options }: WriterInput): string => {
  const showTitle: boolean = !options.hide.includes('title');
  const showLegend: boolean = !options.hide.includes('legend');
  const edgeOptions: EdgeOptions = { showMax: !options.hide.includes('max') };
  const cardOptions: CardOptions = { highlight: new Set(options.highlight), titleOf: hoverTitle };

  const graph: Box = graphBounds(layout, edgeOptions);
  const titleBlock: number = showTitle ? TITLE_H + BLOCK_GAP : 0;
  const legendBlock: number = showLegend ? BLOCK_GAP + LEGEND_H : 0;
  const contentW: number = Math.max(
    graph.width,
    showTitle ? titleWidth(model) : 0,
    showLegend ? legendWidth(model) : 0,
  );
  const width: number = Math.ceil(contentW + 2 * MARGIN);
  const height: number = Math.ceil(graph.height + titleBlock + legendBlock + 2 * MARGIN);
  const graphTop: number = MARGIN + titleBlock;
  const translate: string = `translate(${fmt(MARGIN - graph.x)} ${fmt(graphTop - graph.y)})`;

  const edges: string = layout.edges.map(edgeSvg).join('\n');
  const labels: string = layout.edges
    .map((e: RoutedEdge): string => edgeLabelSvg(e, edgeOptions))
    .filter(Boolean)
    .join('\n');
  const nodes: string = layout.nodes
    .map((n: PlacedNode): string => nodeSvg(n, cardOptions))
    .join('\n');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(model.name ?? model.id)}">`,
    `<!-- generated by draw-factory ${escapeXml(options.version)} from ${escapeXml(model.file)} -->`,
    styleBlock(tokens),
    `<rect class="canvas" width="${width}" height="${height}"/>`,
    showTitle ? titleSvg(model, MARGIN, MARGIN) : '',
    `<g class="graph" transform="${translate}">`,
    edges,
    labels,
    nodes,
    `</g>`,
    showLegend ? legendSvg(model, MARGIN, graphTop + graph.height + BLOCK_GAP) : '',
    `</svg>`,
    '',
  ]
    .filter((line: string): boolean => line !== '')
    .join('\n');
};
