import type { FsClient } from '../../../clients/fs/fs.types.js';
import type { SavePipelineResult } from '../pipelines.types.js';
import { serialisePipelineFile } from '../pipelines.utils.js';
import { locateFactoryFactory } from './locate-factory.service.js';
import type { FactoryLocation } from './locate-factory.service.js';

export interface WritePipelineFileSettings {
  fs: FsClient;
  workDir: string;
}

/** Overwrites `<id>`'s `pipeline.json` (local first, then the kit) atomically. Never creates a factory. */
export const writePipelineFileFactory =
  ({ fs, workDir }: WritePipelineFileSettings) =>
  async (id: string, raw: unknown): Promise<SavePipelineResult> => {
    const found: FactoryLocation | null = await locateFactoryFactory({ fs, workDir })(id);
    if (found === null) return { ok: false, reason: 'not-found' };
    const bytes: number = await fs.writeTextAtomic(found.file, serialisePipelineFile(raw));
    return { ok: true, bytes };
  };
