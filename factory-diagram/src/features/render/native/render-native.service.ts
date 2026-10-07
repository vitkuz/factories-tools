import { createAppError } from '../../../shared/utils/error.utils.js';
import type { GraphEdge, GraphModel } from '../../graph/index.js';
import type { RenderOptions, RenderResult, Renderer } from '../render.types.js';
import { layoutNative, type NativeLayout } from './layout.service.js';
import { writeSvg } from './svg.writer.js';
import { tokensFor, type ThemeTokens } from './themes.js';

/** `--hide loops` / `--hide max` take the edges out before layout, so the lanes close up. */
const withoutHidden = (model: GraphModel, options: RenderOptions): GraphModel => ({
  ...model,
  edges: model.edges.filter(
    (edge: GraphEdge): boolean =>
      !(options.hide.includes('loops') && edge.kind === 'loop') &&
      !(options.hide.includes('max') && edge.kind === 'max'),
  ),
});

const notYet = (what: string, available: string): never => {
  throw createAppError('NOT_IMPLEMENTED', `${what} is not implemented in the native renderer yet`, [
    `available: ${available}`,
  ]);
};

/**
 * The native renderer: the Studio's layout, an SVG writer, no dependencies. Left to right,
 * compact cards, light theme in v1. TODO(M4): detailed / minimal views, dark / mono themes;
 * TB stays a graphviz feature.
 */
export const renderNative: Renderer = (model: GraphModel, options: RenderOptions): RenderResult => {
  if (options.direction !== 'LR') notYet(`--direction ${options.direction}`, 'LR');
  if (options.view !== 'compact') notYet(`--view ${options.view}`, 'compact');
  const tokens: ThemeTokens | undefined = tokensFor(options.theme);
  if (tokens === undefined) return notYet(`--theme ${options.theme}`, 'light');
  const visible: GraphModel = withoutHidden(model, options);
  const layout: NativeLayout = layoutNative(visible);
  const unknown: string[] = options.highlight.filter(
    (slug: string): boolean => !model.nodes.some((n): boolean => n.id === slug),
  );
  return {
    svg: writeSvg({ model: visible, layout, tokens, options }),
    warnings: unknown.map((slug: string): string => `--highlight ${slug}: no such step`),
  };
};
