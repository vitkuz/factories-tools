import type { FsClient } from '../../../clients/fs/fs.types.js';
import type { ReadPipelineResult } from '../pipelines.types.js';
import { locateFactoryFactory } from './locate-factory.service.js';
import type { FactoryLocation } from './locate-factory.service.js';

export interface ReadPipelineFileSettings {
  fs: FsClient;
  workDir: string;
}

/** The absolute path of `<id>`'s `pipeline.json` (local first, then the kit); the controller streams it. */
export const readPipelineFileFactory =
  ({ fs, workDir }: ReadPipelineFileSettings) =>
  async (id: string): Promise<ReadPipelineResult> => {
    const found: FactoryLocation | null = await locateFactoryFactory({ fs, workDir })(id);
    return found === null ? { ok: false, reason: 'not-found' } : { ok: true, file: found.file };
  };
