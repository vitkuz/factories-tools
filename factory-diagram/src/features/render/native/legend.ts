import { estimateSansWidth } from '../../../shared/studio-graph/index.js';
import type { GraphModel } from '../../graph/index.js';
import { escapeXml, fmt } from './native.utils.js';

export const LEGEND_H = 22;
const SAMPLE_W = 28;
const ITEM_GAP = 22;
const FONT = 11;

interface LegendItem {
  label: string;
  /** The classes the sample line borrows from the edges it explains. */
  sampleClass: string;
  /** Sample kind: a line (with arrow), or a dashed card outline for the human gate. */
  shape: 'line' | 'gate';
}

/** What the picture actually contains; an item nobody can see is not explained. */
const itemsFor = (model: GraphModel): LegendItem[] => {
  const kinds: Set<string> = new Set(model.edges.map((e): string => e.kind));
  const hasHuman: boolean = model.nodes.some((n): boolean => n.kind === 'human');
  return [
    { label: 'next step', sampleClass: 'edge edge-forward edge-happy', shape: 'line' },
    ...(kinds.has('loop')
      ? [{ label: 'loop back (×N = cap)', sampleClass: 'edge edge-loop', shape: 'line' as const }]
      : []),
    ...(kinds.has('max')
      ? [{ label: 'when the cap is spent', sampleClass: 'edge edge-max', shape: 'line' as const }]
      : []),
    ...(kinds.has('jump')
      ? [{ label: 'shortcut', sampleClass: 'edge edge-jump', shape: 'line' as const }]
      : []),
    ...(hasHuman
      ? [{ label: 'waits for a person', sampleClass: 'card is-human', shape: 'gate' as const }]
      : []),
  ];
};

const sample = (item: LegendItem, x: number, y: number): string =>
  item.shape === 'gate'
    ? `<g class="${item.sampleClass}"><rect class="card-box" x="${fmt(x)}" y="${fmt(y - 7)}" width="${SAMPLE_W}" height="14" rx="3"/></g>`
    : `<g class="${item.sampleClass}"><path class="edge-path" d="M ${fmt(x)} ${fmt(y)} L ${fmt(x + SAMPLE_W - 4)} ${fmt(y)}"/>` +
      `<polygon class="edge-arrow" points="${fmt(x + SAMPLE_W)},${fmt(y)} ${fmt(x + SAMPLE_W - 9)},${fmt(y - 4.5)} ${fmt(x + SAMPLE_W - 9)},${fmt(y + 4.5)}"/></g>`;

/** The legend: one row, bottom-left, explaining only the edge kinds and gates the picture has. */
export const legendSvg = (model: GraphModel, x: number, y: number): string => {
  const items: LegendItem[] = itemsFor(model);
  let cursor: number = x;
  const parts: string[] = items.map((item: LegendItem): string => {
    const left: number = cursor;
    const labelX: number = left + SAMPLE_W + 8;
    cursor = labelX + estimateSansWidth(item.label, FONT) + ITEM_GAP;
    return (
      sample(item, left, y + LEGEND_H / 2) +
      `<text class="legend-text" x="${fmt(labelX)}" y="${fmt(y + LEGEND_H / 2 + 4)}">${escapeXml(item.label)}</text>`
    );
  });
  return `<g class="legend">${parts.join('')}</g>`;
};

export const legendWidth = (model: GraphModel): number =>
  itemsFor(model).reduce(
    (w: number, item: LegendItem): number =>
      w + SAMPLE_W + 8 + estimateSansWidth(item.label, FONT) + ITEM_GAP,
    0,
  );
