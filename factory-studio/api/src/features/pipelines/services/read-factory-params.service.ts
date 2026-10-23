import type { FactoryParam, PipelineSkill, ReadFactoryParams } from '../pipelines.types.js';
import { extractParams } from '../pipelines.utils.js';

export interface ReadFactoryParamsSettings {
  listPipelineSkills: () => Promise<PipelineSkill[]>;
}

/**
 * The declared params of one listed pipeline, read fresh like the list itself, so a start is
 * checked against the `pipeline.json` on disk now. `null` when no such pipeline is listed.
 */
export const readFactoryParamsFactory =
  ({ listPipelineSkills }: ReadFactoryParamsSettings): ReadFactoryParams =>
  async (id: string): Promise<FactoryParam[] | null> => {
    const skills: PipelineSkill[] = await listPipelineSkills();
    const skill: PipelineSkill | undefined = skills.find(
      (candidate: PipelineSkill): boolean => candidate.id === id,
    );
    return skill === undefined ? null : extractParams(skill.pipeline);
  };
