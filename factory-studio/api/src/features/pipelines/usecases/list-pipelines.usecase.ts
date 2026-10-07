import type {
  PipelineListEntry,
  PipelineListResponse,
  PipelineServices,
  PipelineSkill,
} from '../pipelines.types.js';

export type ListPipelinesSettings = Pick<PipelineServices, 'listPipelineSkills'>;

export const listPipelinesFactory =
  ({ listPipelineSkills }: ListPipelinesSettings) =>
  async (): Promise<PipelineListResponse> => {
    const skills: PipelineSkill[] = await listPipelineSkills();
    return {
      pipelines: skills.map((skill: PipelineSkill): PipelineListEntry => ({
        id: skill.id,
        path: skill.path,
        pipeline: skill.pipeline,
      })),
    };
  };
