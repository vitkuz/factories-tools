import { estimateSansWidth } from '../../../shared/studio-graph/index.js';
import type { GraphModel } from '../../graph/index.js';
import { escapeXml, fmt, semiboldWidth } from './native.utils.js';

export const TITLE_H = 44;
const NAME_FONT = 16;
const META_FONT = 12;

/** `id · 6 steps · by author` — the facts, no prose. */
export const titleMeta = (model: GraphModel): string =>
  [
    model.id,
    `${model.stepCount} step${model.stepCount === 1 ? '' : 's'}`,
    ...(model.author === null ? [] : [`by ${model.author}`]),
  ].join(' · ');

export const titleName = (model: GraphModel): string => model.name ?? model.id;

/** The title block, top-left: the name on one line, the id / step count / author under it. */
export const titleSvg = (model: GraphModel, x: number, y: number): string =>
  `<g class="title">` +
  `<text class="title-name" x="${fmt(x)}" y="${fmt(y + NAME_FONT + 2)}">${escapeXml(titleName(model))}</text>` +
  `<text class="title-meta" x="${fmt(x)}" y="${fmt(y + NAME_FONT + 2 + 6 + META_FONT)}">${escapeXml(titleMeta(model))}</text>` +
  `</g>`;

export const titleWidth = (model: GraphModel): number =>
  Math.max(
    semiboldWidth(titleName(model), NAME_FONT),
    estimateSansWidth(titleMeta(model), META_FONT),
  );
