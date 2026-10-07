import type { AppLogger } from '../../../shared/types.js';
import type { PipelineServices, PipelineSkill } from '../../pipelines/pipelines.types.js';
import type { RunRecord, RunServices, RunsPayload } from '../runs.types.js';
import { pipelinesById } from '../runs.utils.js';

export interface ListRunsSettings
  extends Pick<PipelineServices, 'listPipelineSkills'>, Pick<RunServices, 'collectRunRecords'> {
  logger?: AppLogger;
  now?: () => Date;
}

/** The dashboard payload, fresh from disk. A run with no definition is kept: the app says so. */
export const listRunsFactory =
  ({
    listPipelineSkills,
    collectRunRecords,
    logger,
    now = (): Date => new Date(),
  }: ListRunsSettings) =>
  async (): Promise<RunsPayload> => {
    const [skills, runs]: [PipelineSkill[], RunRecord[]] = await Promise.all([
      listPipelineSkills(),
      collectRunRecords(),
    ]);
    return {
      generatedAt: now().toISOString(),
      pipelines: pipelinesById(skills, (message: string): void => logger?.warn(message)),
      runs,
    };
  };
