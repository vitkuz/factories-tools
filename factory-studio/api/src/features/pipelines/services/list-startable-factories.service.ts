import type { FileInfo, FsClient } from '../../../clients/fs/fs.types.js';
import type { PipelineSkill } from '../pipelines.types.js';
import { wrapperSkillFile } from '../pipelines.utils.js';

export interface ListStartableFactoriesSettings {
  fs: FsClient;
  workDir: string;
  listPipelineSkills: () => Promise<PipelineSkill[]>;
}

/**
 * The ids `/<id> <prompt>` can start: a listed `factories/<id>/pipeline.json` whose wrapper
 * skill `.claude/skills/<id>/SKILL.md` is a file. Read on each call, sorted like the list.
 */
export const listStartableFactoriesFactory =
  ({ fs, workDir, listPipelineSkills }: ListStartableFactoriesSettings) =>
  async (): Promise<string[]> => {
    const skills: PipelineSkill[] = await listPipelineSkills();
    const checked: (string | null)[] = await Promise.all(
      skills.map(async (skill: PipelineSkill): Promise<string | null> => {
        const info: FileInfo | null = await fs.stat(wrapperSkillFile(workDir, skill.id));
        return info !== null && info.isFile ? skill.id : null;
      }),
    );
    return checked.filter((id: string | null): id is string => id !== null);
  };
