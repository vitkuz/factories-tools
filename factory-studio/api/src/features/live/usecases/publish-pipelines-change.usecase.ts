import type { AppLogger } from '../../../shared/types.js';
import type { PipelineServices, PipelineSkill } from '../../pipelines/pipelines.types.js';
import { pipelinesById } from '../../runs/runs.utils.js';
import type { SubscriptionRegistry } from '../live.types.js';

export interface PublishPipelinesChangeSettings extends Pick<
  PipelineServices,
  'listPipelineSkills'
> {
  registry: Pick<SubscriptionRegistry, 'publish' | 'count'>;
  logger?: AppLogger;
}

/**
 * A `pipeline.json` was written under `factories/` or `factories.local/`: the `runs`
 * subscribers get the whole pipelines map again (the same one GET /runs carries), so a graph
 * drawn from the definition follows the edit.
 */
export const publishPipelinesChangeFactory =
  ({ listPipelineSkills, registry, logger }: PublishPipelinesChangeSettings) =>
  async (): Promise<void> => {
    if (registry.count('runs') === 0) return;
    try {
      const skills: PipelineSkill[] = await listPipelineSkills();
      registry.publish('runs', {
        type: 'pipelines.changed',
        pipelines: pipelinesById(skills, (message: string): void => logger?.warn(message)),
      });
    } catch (error: unknown) {
      logger?.warn('pipelines change not published', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
