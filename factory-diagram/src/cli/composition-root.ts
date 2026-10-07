import { createFileSystemAdapter, type FileSystemAdapter } from '../adapters/file-system/index.js';
import { createShellAdapter } from '../adapters/shell/index.js';
import { drawFactory, type Draw } from '../features/draw/index.js';
import { loadPipelineFactory, type LoadPipeline } from '../features/load/index.js';
import { renderNative } from '../features/render/native/index.js';
import type { Renderer } from '../features/render/render.types.js';
import type { LoggerPort } from '../shared/types/logger.types.js';
import { logger } from '../shared/utils/logger.js';

export interface Container {
  fileSystem: FileSystemAdapter;
  logger: LoggerPort;
  loadPipeline: LoadPipeline;
  draw: Draw;
}

/** Everything with a side effect is built here, once, and handed down as data. */
export const createContainer = (): Container => {
  const fileSystem: FileSystemAdapter = createFileSystemAdapter();
  const loadPipeline: LoadPipeline = loadPipelineFactory({
    fileSystem,
    shell: createShellAdapter(),
  });
  // TODO(M4): graphviz and mermaid renderers register here.
  const renderers: Partial<Record<string, Renderer>> = { native: renderNative };
  return {
    fileSystem,
    logger,
    loadPipeline,
    draw: drawFactory({ fileSystem, loadPipeline, renderers, logger }),
  };
};
