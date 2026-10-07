import os from 'node:os';
import path from 'node:path';
import type { FileSystemAdapter } from '../../../adapters/file-system/index.js';
import type { Harness } from '../../harness/index.js';
import type {
  LoadPipelineRequest,
  LoadedPipeline,
  ResolveContext,
  ResolvedPipeline,
} from '../pipeline.types.js';
import { formatDate, wrapperSkillPath } from '../pipeline.utils.js';
import {
  checkDefinition,
  locatePipelineFileFactory,
  readPipelineFactory,
  resolvePipeline,
  verifyWorkspaceFactory,
} from '../services/index.js';

export interface LoadPipelineDeps {
  fileSystem: FileSystemAdapter;
  /** Injected so a test, or a resumed run, decides what "today" is. */
  now: () => Date;
  homeDir?: () => string;
  /** Whose custom agents the load-time check looks for. Claude when left out. */
  harness?: Harness;
}

/** The outside world, gathered once into plain data. After this line everything is pure. */
const toContext =
  (deps: LoadPipelineDeps) =>
  (request: LoadPipelineRequest, id: string): ResolveContext => ({
    anchors: {
      rootPath: path.resolve(request.rootPath),
      // The factory's wrapper skill, not the folder holding pipeline.json: that one is {{factoryPath}}.
      skillPath: wrapperSkillPath(path.resolve(request.rootPath))(id),
      homePath: (deps.homeDir ?? os.homedir)(),
    },
    date: request.date ?? formatDate(deps.now()),
    suppliedParams: request.suppliedParams,
    ...(request.slug === undefined ? {} : { slug: request.slug }),
  });

/**
 * load = locate → read → check → resolve → verify.
 * The loader answers "is this a pipeline?", the resolver "what does it say for THIS run?".
 */
export const loadPipelineFactory =
  (deps: LoadPipelineDeps) =>
  async (request: LoadPipelineRequest): Promise<ResolvedPipeline> => {
    const locate = locatePipelineFileFactory(deps.fileSystem)(path.resolve(request.rootPath));
    const read = readPipelineFactory(deps.fileSystem);
    const verify = verifyWorkspaceFactory(deps.fileSystem, deps.harness);

    const file: string = await locate(request.pipeline);
    const loaded: LoadedPipeline = checkDefinition(await read(file));
    return verify(resolvePipeline(toContext(deps)(request, loaded.definition.id))(loaded));
  };

export type LoadPipeline = ReturnType<typeof loadPipelineFactory>;
