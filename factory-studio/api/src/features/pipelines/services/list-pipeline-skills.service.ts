import path from 'node:path';
import type { ZodSafeParseResult } from 'zod';
import type { FsClient, JsonRead } from '../../../clients/fs/fs.types.js';
import type { AppLogger } from '../../../shared/types.js';
import { discoveredPipelineSchema } from '../pipelines.schema.js';
import type { DiscoveredPipeline, PipelineSkill } from '../pipelines.types.js';
import {
  FACTORY_DIRS,
  factoryDirIn,
  pipelineFileIn,
  pipelineRelativePathIn,
} from '../pipelines.utils.js';

export interface ListPipelineSkillsSettings {
  fs: FsClient;
  workDir: string;
  logger?: AppLogger;
}

/** The skills found under one factory folder (`factories.local` or `factories`). */
const listInFactory =
  ({ fs, workDir, logger }: ListPipelineSkillsSettings) =>
  async (dir: string): Promise<PipelineSkill[]> => {
    const ids: string[] = await fs.subdirectories(path.join(workDir, dir));
    const found: (PipelineSkill | null)[] = await Promise.all(
      ids.map(async (id: string): Promise<PipelineSkill | null> => {
        const file: string = pipelineFileIn(dir)(workDir, id);
        const read: JsonRead = await fs.readJson(file);
        if (!read.ok) {
          if (read.reason === 'unparseable') {
            logger?.warn('skipping unparseable pipeline.json', { id, message: read.message });
          }
          return null;
        }
        const parsed: ZodSafeParseResult<DiscoveredPipeline> = discoveredPipelineSchema.safeParse(
          read.value,
        );
        if (!parsed.success) {
          logger?.warn('skipping pipeline.json without a string id and steps', { id });
          return null;
        }
        return {
          id,
          dir: factoryDirIn(dir)(workDir, id),
          file,
          path: pipelineRelativePathIn(dir)(id),
          pipeline: parsed.data,
        };
      }),
    );
    return found.filter((skill: PipelineSkill | null): skill is PipelineSkill => skill !== null);
  };

/**
 * Every `factories.local/<id>/` and `factories/<id>/` folder holding a `pipeline.json`, sorted by
 * id, a local id shadowing the shared one. Read on each call, never cached: adding or fixing a
 * factory must not need a restart. A file that does not parse or has no `id`/`steps` is skipped
 * with a warning; a folder without the file is not a pipeline.
 */
export const listPipelineSkillsFactory =
  (settings: ListPipelineSkillsSettings) => async (): Promise<PipelineSkill[]> => {
    const byDir: PipelineSkill[][] = await Promise.all(FACTORY_DIRS.map(listInFactory(settings)));
    const seen: Set<string> = new Set();
    return byDir
      .flat()
      .filter((skill: PipelineSkill): boolean => {
        if (seen.has(skill.id)) return false;
        seen.add(skill.id);
        return true;
      })
      .sort((a: PipelineSkill, b: PipelineSkill): number => a.id.localeCompare(b.id));
  };
