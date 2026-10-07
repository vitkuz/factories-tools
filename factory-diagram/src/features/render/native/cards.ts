import { NODE_W } from '../../../shared/studio-graph/index.js';
import type { GraphNode } from '../../graph/index.js';
import type { Box, PlacedNode } from './native.types.js';
import {
  CARD_PAD_X,
  CARD_PAD_Y,
  CHIP_FONT,
  CHIP_H,
  META_FONT,
  SLUG_FONT,
  SLUG_LINE_H,
  ellipsize,
  escapeXml,
  fmt,
  modelClass,
  semiboldWidth,
  wrapSlug,
} from './native.utils.js';
import { estimateSansWidth } from '../../../shared/studio-graph/index.js';

const CONTENT_W: number = NODE_W - 2 * CARD_PAD_X;
const WAITS = 'waits for a person';

export interface CardOptions {
  highlight: ReadonlySet<string>;
  /** `<title>` text per node — what a browser shows on hover. */
  titleOf: (node: GraphNode) => string;
}

const text = (
  x: number,
  y: number,
  className: string,
  content: string,
  extra: string = '',
): string =>
  `<text class="${className}" x="${fmt(x)}" y="${fmt(y)}"${extra}>${escapeXml(content)}</text>`;

/** A person: head and shoulders, 12 px tall, drawn at the top-right of a human gate. */
const personGlyph = (x: number, y: number): string =>
  `<g class="gate-glyph" transform="translate(${fmt(x)} ${fmt(y)})">` +
  `<circle cx="6" cy="3.5" r="3"/>` +
  `<path d="M 0 13 C 0 8.5 12 8.5 12 13 Z"/>` +
  `</g>`;

/** A warning badge: a small triangle with a bang, for a step nothing reaches. */
const warnBadge = (x: number, y: number): string =>
  `<g class="warn-badge" transform="translate(${fmt(x)} ${fmt(y)})">` +
  `<path d="M 6 0 L 12 11 L 0 11 Z"/>` +
  `<text x="6" y="9.6">!</text>` +
  `</g>`;

/** The model chip: a tinted rounded box with the alias in the model's colour. */
const chip = (x: number, y: number, model: string): string => {
  const width: number = estimateSansWidth(model, CHIP_FONT) + 12;
  return (
    `<g class="chip ${modelClass(model)}">` +
    `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${CHIP_H}" rx="4"/>` +
    text(x + width / 2, y + 13, 'chip-text', model, ' text-anchor="middle"') +
    `</g>`
  );
};

/**
 * A compact step card: slug on one or two lines, the agent, then the model chip — or the
 * "waits for a person" line on a gate. 156 × 104 like the Studio's compact card.
 */
export const stepCard = (placed: PlacedNode, options: CardOptions): string => {
  const { node, box } = placed;
  const human: boolean = node.kind === 'human';
  const classes: string[] = [
    'card',
    human ? 'is-human' : '',
    node.unreachable ? 'is-unreachable' : '',
    options.highlight.has(node.id) ? 'is-highlight' : '',
  ].filter(Boolean);
  const slugLines: string[] = wrapSlug(node.id, CONTENT_W, 2, (t: string): number =>
    semiboldWidth(t, SLUG_FONT),
  );
  const left: number = box.x + CARD_PAD_X;
  const slugTop: number = box.y + CARD_PAD_Y;
  const slug: string = slugLines
    .map((line: string, i: number): string =>
      text(left, slugTop + SLUG_LINE_H * i + SLUG_FONT, 'card-slug', line),
    )
    .join('');
  const agentY: number = slugTop + SLUG_LINE_H * slugLines.length + 4 + META_FONT;
  const agent: string = text(
    left,
    agentY,
    'card-agent',
    ellipsize(node.agent ?? '', CONTENT_W, (t: string): number => estimateSansWidth(t, META_FONT)),
  );
  const lineTop: number = agentY + 8;
  const third: string = human
    ? text(left, lineTop + META_FONT, 'card-waits', WAITS)
    : node.model === null
      ? text(left, lineTop + META_FONT, 'card-model', 'inherits model')
      : chip(left, lineTop, node.model);
  const badges: string = [
    human ? personGlyph(box.x + box.width - CARD_PAD_X - 12, box.y + CARD_PAD_Y + 2) : '',
    node.unreachable
      ? warnBadge(box.x + box.width - CARD_PAD_X - 12 - (human ? 18 : 0), box.y + CARD_PAD_Y + 2)
      : '',
  ].join('');
  return (
    `<g class="${classes.join(' ')}" data-step="${escapeXml(node.id)}">` +
    `<title>${escapeXml(options.titleOf(node))}</title>` +
    `<rect class="card-box" x="${fmt(box.x)}" y="${fmt(box.y)}" width="${fmt(box.width)}" height="${fmt(box.height)}" rx="6"/>` +
    slug +
    agent +
    third +
    badges +
    `</g>`
  );
};

/** START / END: a pill with its word, 60 × 28 and 52 × 28 like the Studio's terminals. */
export const terminalPill = (placed: PlacedNode): string => {
  const { node, box } = placed;
  const label: string = node.kind === 'start' ? 'Start' : 'End';
  return (
    `<g class="terminal terminal-${node.kind}">` +
    `<title>${label}</title>` +
    `<rect x="${fmt(box.x)}" y="${fmt(box.y)}" width="${fmt(box.width)}" height="${fmt(box.height)}" rx="${fmt(box.height / 2)}"/>` +
    text(
      box.x + box.width / 2,
      box.y + box.height / 2 + 4,
      'terminal-text',
      label,
      ' text-anchor="middle"',
    ) +
    `</g>`
  );
};

export const nodeSvg = (placed: PlacedNode, options: CardOptions): string =>
  placed.node.kind === 'start' || placed.node.kind === 'end'
    ? terminalPill(placed)
    : stepCard(placed, options);

export const boxOf = (placed: PlacedNode): Box => placed.box;
