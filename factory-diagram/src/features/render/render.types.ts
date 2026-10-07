import type { z } from 'zod';
import type { GraphModel } from '../graph/index.js';
import type {
  directionSchema,
  formatSchema,
  hideableSchema,
  renderOptionsSchema,
  rendererSchema,
  themeSchema,
  viewSchema,
} from './render.schema.js';

export type RendererName = z.infer<typeof rendererSchema>;
export type View = z.infer<typeof viewSchema>;
export type Theme = z.infer<typeof themeSchema>;
export type Direction = z.infer<typeof directionSchema>;
export type OutputFormat = z.infer<typeof formatSchema>;
export type Hideable = z.infer<typeof hideableSchema>;
export type RenderOptions = z.infer<typeof renderOptionsSchema>;

export interface RenderResult {
  /** The SVG document, complete and self-contained. */
  svg: string;
  /** Anything the renderer could not draw as asked. */
  warnings: string[];
}

/** A renderer only consumes the model; adding one must not touch loading, validation or the model. */
export type Renderer = (graph: GraphModel, options: RenderOptions) => RenderResult;
