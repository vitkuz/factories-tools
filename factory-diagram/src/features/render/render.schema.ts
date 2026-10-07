import { z } from 'zod';

export const rendererSchema = z.enum(['native', 'graphviz', 'mermaid']);
export const viewSchema = z.enum(['compact', 'detailed', 'minimal']);
export const themeSchema = z.enum(['light', 'dark', 'mono']);
export const directionSchema = z.enum(['LR', 'TB']);
export const formatSchema = z.enum(['svg', 'png', 'dot', 'mmd', 'json']);
export const hideableSchema = z.enum(['loops', 'max', 'knowledge', 'legend', 'title']);

/** Everything a renderer may be asked for. A renderer that cannot honour an option says so. */
export const renderOptionsSchema = z.strictObject({
  renderer: rendererSchema.default('native'),
  view: viewSchema.default('compact'),
  theme: themeSchema.default('light'),
  direction: directionSchema.default('LR'),
  hide: z.array(hideableSchema).default([]),
  highlight: z.array(z.string().min(1)).default([]),
  /** Printed in the generator comment. */
  version: z.string().min(1),
});
