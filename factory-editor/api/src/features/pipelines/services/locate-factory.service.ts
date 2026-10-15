import type { FileInfo, FsClient } from '../../../clients/fs/fs.types.js';
import {
  FACTORY_DIRS,
  factoryDirIn,
  isPipelineId,
  pipelineFileIn,
  pipelineRelativePathIn,
} from '../pipelines.utils.js';

export interface LocateFactorySettings {
  fs: FsClient;
  workDir: string;
}

/** Where `<id>` is on disk: its folder, its `pipeline.json`, and that file relative to `WORK_DIR`. */
export interface FactoryLocation {
  dir: string;
  file: string;
  path: string;
}

/**
 * `<id>` is looked up under `factories.local/` first (the project's own), then `factories/` (the
 * kit): the first folder holding a `pipeline.json` file wins. `null` when neither has it.
 */
export const locateFactoryFactory =
  ({ fs, workDir }: LocateFactorySettings) =>
  async (id: string): Promise<FactoryLocation | null> => {
    if (!isPipelineId(id)) return null;
    for (const dir of FACTORY_DIRS) {
      const file: string = pipelineFileIn(dir)(workDir, id);
      const info: FileInfo | null = await fs.stat(file);
      if (info !== null && info.isFile) {
        return { dir: factoryDirIn(dir)(workDir, id), file, path: pipelineRelativePathIn(dir)(id) };
      }
    }
    return null;
  };
