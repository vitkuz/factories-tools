import path from 'node:path';
import type { FileSystemAdapter } from '../../../adapters/file-system/index.js';
import type { LoggerPort } from '../../../shared/types/logger.types.js';
import { createAppError } from '../../../shared/utils/error.utils.js';
import { buildGraph, type GraphModel } from '../../graph/index.js';
import {
  listPipelineIdsFactory,
  type LoadPipeline,
  type LoadedPipeline,
} from '../../load/index.js';
import type { OutputFormat, RenderResult, Renderer } from '../../render/render.types.js';
import type { DrawReport, DrawRequest, DrawnFile } from '../draw.types.js';
import { indexMarkdown, namesFile, outputDirForAll, outputFileFor } from '../draw.utils.js';

export interface DrawDeps {
  fileSystem: FileSystemAdapter;
  loadPipeline: LoadPipeline;
  /** One renderer per name; a name missing here is not implemented yet. */
  renderers: Partial<Record<string, Renderer>>;
  logger: LoggerPort;
}

/** `--format json` is the model itself; every other format goes through a renderer. */
const RENDERED_FORMATS: readonly OutputFormat[] = ['svg'];

const toText =
  (deps: DrawDeps, request: DrawRequest) =>
  (model: GraphModel): { text: string; warnings: string[] } => {
    if (request.format === 'json')
      return { text: `${JSON.stringify(model, null, 2)}\n`, warnings: [] };
    if (!RENDERED_FORMATS.includes(request.format)) {
      // TODO(M4/M5): png via @resvg/resvg-js@2.6.2, dot/mmd via the graphviz and mermaid builders.
      throw createAppError('NOT_IMPLEMENTED', `--format ${request.format} is not implemented yet`, [
        `available: ${['svg', 'json'].join(', ')}`,
      ]);
    }
    const renderer: Renderer | undefined = deps.renderers[request.options.renderer];
    if (renderer === undefined) {
      // TODO(M4): graphviz via @hpcc-js/wasm-graphviz@1.29.2 + ts-graphviz@3.0.7; mermaid source builder.
      throw createAppError(
        'NOT_IMPLEMENTED',
        `--renderer ${request.options.renderer} is not implemented yet`,
        [`available: ${Object.keys(deps.renderers).join(', ')}`],
      );
    }
    const result: RenderResult = renderer(model, request.options);
    return { text: result.svg, warnings: result.warnings };
  };

const drawOne =
  (deps: DrawDeps, request: DrawRequest) =>
  (reference: string, file: string | undefined): DrawnFile => {
    const loaded: LoadedPipeline = deps.loadPipeline({
      pipeline: reference,
      rootPath: request.rootPath,
    });
    const model: GraphModel = buildGraph(loaded);
    const { text, warnings } = toText(deps, request)(model);
    const target: string =
      file ?? outputFileFor(request.rootPath, model.id, request.format, request.out);
    const all: string[] = [...model.warnings, ...warnings];
    all.forEach((warning: string): void => deps.logger.warn(warning, { pipeline: model.id }));
    if (request.strict && all.length > 0) {
      throw createAppError(
        'PIPELINE_INVALID',
        `${model.id}: warnings are errors under --strict`,
        all,
      );
    }
    const changed: boolean = deps.fileSystem.writeText(target, text);
    deps.logger.info(changed ? 'written' : 'unchanged', { file: target });
    return { id: model.id, file: target, changed, warnings: all };
  };

/**
 * One pipeline → one file; `--all` → every factory's pipeline.json into one folder plus an
 * `index.md`. Nothing here knows how a picture is drawn.
 */
export const drawFactory =
  (deps: DrawDeps) =>
  (request: DrawRequest): DrawReport => {
    const rootPath: string = path.resolve(request.rootPath);
    const one = drawOne(deps, { ...request, rootPath });
    if (!request.all) {
      if (request.pipeline === undefined) {
        throw createAppError('OPTION_INVALID', 'name a pipeline, or pass --all', [
          `available ids: ${listPipelineIdsFactory(deps.fileSystem)(rootPath).join(', ') || '(none)'}`,
        ]);
      }
      return { files: [one(request.pipeline, undefined)] };
    }
    if (request.out !== undefined && namesFile(request.out, request.format)) {
      throw createAppError(
        'OPTION_INVALID',
        '--all writes one file per factory: --out must be a folder',
      );
    }
    const directory: string = outputDirForAll(rootPath, request.out);
    const ids: string[] = listPipelineIdsFactory(deps.fileSystem)(rootPath);
    if (ids.length === 0) {
      throw createAppError(
        'PIPELINE_NOT_FOUND',
        `no factories/<id>/pipeline.json or factories.local/<id>/pipeline.json under ${rootPath}`,
      );
    }
    const files: DrawnFile[] = ids.map((id: string): DrawnFile =>
      one(id, outputFileFor(rootPath, id, request.format, directory)),
    );
    const index: string = path.join(directory, 'index.md');
    deps.fileSystem.writeText(index, indexMarkdown(files, directory));
    return { files, index };
  };

export type Draw = ReturnType<typeof drawFactory>;
