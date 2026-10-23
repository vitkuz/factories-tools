import type {
  PipelineListEntry,
  PipelineListResponse,
  PipelineServices,
  PipelineSkill,
} from '../pipelines.types.js';
import { extractDescription, extractParams } from '../pipelines.utils.js';

export type ListPipelinesSettings = Pick<PipelineServices, 'listPipelineSkills'>;

export const listPipelinesFactory =
  ({ listPipelineSkills }: ListPipelinesSettings) =>
  async (): Promise<PipelineListResponse> => {
    const skills: PipelineSkill[] = await listPipelineSkills();
    return {
      pipelines: skills.map((skill: PipelineSkill): PipelineListEntry => {
        const description: string | undefined = extractDescription(skill.pipeline);
        return {
          id: skill.id,
          path: skill.path,
          pipeline: skill.pipeline,
          params: extractParams(skill.pipeline),
          ...(description === undefined ? {} : { description }),
        };
      }),
    };
  };
