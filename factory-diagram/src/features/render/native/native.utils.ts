import { estimateSansWidth } from '../../../shared/studio-graph/index.js';
import type { Bounds, Box, Pill, Point, Side } from './native.types.js';

/* ---- sizes the Studio's CSS fixes, that the layout port does not export */
export const PILL_H = 18;
export const PILL_PAD = 6;
export const PILL_GAP = 4;
export const PILL_FONT = 12;
export const ARROW = 9;
export const CORNER = 6;
/** A lane edge entering a left-side handle turns down this far before the card. */
export const LANE_INSET = 16;
export const CARD_PAD_X = 12;
export const CARD_PAD_Y = 10;
export const SLUG_FONT = 14;
export const SLUG_LINE_H = 18;
export const META_FONT = 12;
export const CHIP_H = 18;
export const CHIP_FONT = 11;
/** Plex Sans semibold runs a little wider than the Studio's 0.56 em estimate for regular text. */
export const SEMIBOLD_FACTOR = 1.08;

// --- text ----------------------------------------------------------------------------------

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

export const escapeXml = (text: string): string =>
  text.replace(/[&<>"']/g, (char: string): string => XML_ESCAPES[char] ?? char);

/** Numbers as the SVG prints them: at most two decimals, no `-0`, no float noise. */
export const fmt = (value: number): string => {
  const rounded: number = Math.round(value * 100) / 100;
  return String(rounded === 0 ? 0 : rounded);
};

export const semiboldWidth = (text: string, fontSize: number): number =>
  estimateSansWidth(text, fontSize) * SEMIBOLD_FACTOR;

/** Cut a line to `maxWidth` with an ellipsis; untouched when it fits. */
export const ellipsize = (
  text: string,
  maxWidth: number,
  widthOf: (text: string) => number,
): string => {
  if (widthOf(text) <= maxWidth) return text;
  let kept: string = text;
  while (kept.length > 1 && widthOf(`${kept}…`) > maxWidth) kept = kept.slice(0, -1);
  return `${kept}…`;
};

/**
 * A slug on at most `maxLines` lines, broken after hyphens (`frame-` / `question`), the last
 * line ellipsized when the rest does not fit. A single segment longer than a line is cut too.
 */
export const wrapSlug = (
  slug: string,
  maxWidth: number,
  maxLines: number,
  widthOf: (text: string) => number,
): string[] => {
  const segments: string[] = slug.match(/[^-]+-?/g) ?? [slug];
  const lines: string[] = [];
  let line: string = '';
  for (const segment of segments) {
    if (line === '' || widthOf(line + segment) <= maxWidth) {
      line += segment;
      continue;
    }
    lines.push(line);
    line = segment;
  }
  lines.push(line);
  if (lines.length <= maxLines) {
    return lines.map((l: string): string => ellipsize(l, maxWidth, widthOf));
  }
  const kept: string[] = lines.slice(0, maxLines - 1);
  const rest: string = lines.slice(maxLines - 1).join('');
  return [...kept, ellipsize(rest, maxWidth, widthOf)];
};

// --- pills ---------------------------------------------------------------------------------

export const pillWidth = (text: string): number =>
  estimateSansWidth(text, PILL_FONT) + 2 * PILL_PAD;

/** The row of pills an edge shows: one per result, the happy one lit; loops and caps decorated. */
export const pillsFor = (
  results: readonly string[],
  kind: 'forward' | 'loop' | 'max' | 'jump',
  max: number | null,
  happy: boolean,
  showMax: boolean,
): Pill[] =>
  results.map((result: string, i: number): Pill => {
    const prefix: string = kind === 'loop' ? '↺ ' : '';
    // only a loop gets the badge: lanes have room, while the column gap between two cards is
    // sized by the Studio for the bare result words (a forward cap is in the edge's title)
    const count: string = showMax && max !== null && i === 0 && kind === 'loop' ? ` ×${max}` : '';
    const text: string = `${prefix}${result}${count}`;
    return { text, lit: happy && i === 0, width: pillWidth(text) };
  });

export const pillRowWidth = (pills: readonly Pill[]): number =>
  pills.reduce((w: number, p: Pill): number => w + p.width, 0) +
  Math.max(0, pills.length - 1) * PILL_GAP;

// --- geometry ------------------------------------------------------------------------------

export const center = (box: Box): Point => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

/** The Studio's handle positions on a card: left/right at mid-height, top/bottom at 20 / 50 / 80 %. */
export const handlePoint = (box: Box, side: Side, fraction: number): Point => {
  switch (side) {
    case 'left':
      return { x: box.x, y: box.y + box.height / 2 };
    case 'right':
      return { x: box.x + box.width, y: box.y + box.height / 2 };
    case 'top':
      return { x: box.x + box.width * fraction, y: box.y };
    default:
      return { x: box.x + box.width * fraction, y: box.y + box.height };
  }
};

/** Points of a row edge: straight when level, else right → down/up at the middle → right. */
export const rowPoints = (from: Point, to: Point): Point[] => {
  if (Math.abs(from.y - to.y) < 0.5) return [from, to];
  const midX: number = (from.x + to.x) / 2;
  return [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to];
};

/**
 * Points of a lane edge: out of the card to the lane, along it, and into the target — straight
 * down/up when the target handle is on its top or bottom, with a turn before a left-side handle.
 */
export const lanePoints = (from: Point, to: Point, toSide: Side, laneY: number): Point[] => {
  const start: Point[] = [from, { x: from.x, y: laneY }];
  if (toSide === 'left') {
    const turnX: number = to.x - LANE_INSET;
    return [...start, { x: turnX, y: laneY }, { x: turnX, y: to.y }, to];
  }
  return [...start, { x: to.x, y: laneY }, to];
};

/** A polyline as an SVG path with rounded corners, dropping zero-length segments. */
export const roundedPath = (points: readonly Point[], radius: number = CORNER): string => {
  const pts: Point[] = points.filter(
    (p: Point, i: number): boolean =>
      i === 0 || Math.abs(p.x - points[i - 1]!.x) > 0.01 || Math.abs(p.y - points[i - 1]!.y) > 0.01,
  );
  if (pts.length < 2) return '';
  const first: Point = pts[0]!;
  const parts: string[] = [`M ${fmt(first.x)} ${fmt(first.y)}`];
  for (let i = 1; i < pts.length - 1; i += 1) {
    const prev: Point = pts[i - 1]!;
    const corner: Point = pts[i]!;
    const next: Point = pts[i + 1]!;
    const inLen: number = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const outLen: number = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r: number = Math.min(radius, inLen / 2, outLen / 2);
    const inDir: Point = { x: (corner.x - prev.x) / inLen, y: (corner.y - prev.y) / inLen };
    const outDir: Point = { x: (next.x - corner.x) / outLen, y: (next.y - corner.y) / outLen };
    const a: Point = { x: corner.x - inDir.x * r, y: corner.y - inDir.y * r };
    const b: Point = { x: corner.x + outDir.x * r, y: corner.y + outDir.y * r };
    parts.push(
      `L ${fmt(a.x)} ${fmt(a.y)}`,
      `Q ${fmt(corner.x)} ${fmt(corner.y)} ${fmt(b.x)} ${fmt(b.y)}`,
    );
  }
  const last: Point = pts[pts.length - 1]!;
  parts.push(`L ${fmt(last.x)} ${fmt(last.y)}`);
  return parts.join(' ');
};

/** A filled triangle at `tip`, pointing the way the edge arrives: into a left side it points right, etc. */
export const arrowPoints = (tip: Point, side: Side): string => {
  const h: number = ARROW / 2;
  const triangle: Point[] =
    side === 'top'
      ? [tip, { x: tip.x - h, y: tip.y - ARROW }, { x: tip.x + h, y: tip.y - ARROW }]
      : side === 'bottom'
        ? [tip, { x: tip.x - h, y: tip.y + ARROW }, { x: tip.x + h, y: tip.y + ARROW }]
        : side === 'right'
          ? [tip, { x: tip.x + ARROW, y: tip.y - h }, { x: tip.x + ARROW, y: tip.y + h }]
          : [tip, { x: tip.x - ARROW, y: tip.y - h }, { x: tip.x - ARROW, y: tip.y + h }];
  return triangle.map((p: Point): string => `${fmt(p.x)},${fmt(p.y)}`).join(' ');
};

/** The label point of a row edge: the middle of the vertical segment, or the middle of the line. */
export const rowLabel = (points: readonly Point[]): Point => {
  const first: Point = points[0]!;
  const last: Point = points[points.length - 1]!;
  return { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
};

export const emptyBounds = (): Bounds => ({
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
});

export const includeBox = (bounds: Bounds, box: Box): Bounds => ({
  minX: Math.min(bounds.minX, box.x),
  minY: Math.min(bounds.minY, box.y),
  maxX: Math.max(bounds.maxX, box.x + box.width),
  maxY: Math.max(bounds.maxY, box.y + box.height),
});

export const includePoint = (bounds: Bounds, point: Point, pad: number = 0): Bounds =>
  includeBox(bounds, { x: point.x - pad, y: point.y - pad, width: 2 * pad, height: 2 * pad });

export const boundsToBox = (bounds: Bounds): Box => ({
  x: bounds.minX,
  y: bounds.minY,
  width: bounds.maxX - bounds.minX,
  height: bounds.maxY - bounds.minY,
});

export const modelClass = (model: string | null): string => {
  switch (model) {
    case 'fable':
    case 'opus':
    case 'sonnet':
    case 'haiku':
      return `chip-${model}`;
    default:
      return 'chip-other';
  }
};
