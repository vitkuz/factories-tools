import type { AppLogger } from '../../../shared/types.js';
import type {
  CreatePipelineResult,
  NewPipelineFile,
  PipelineServices,
} from '../pipelines.types.js';

export interface CreatePipelineSettings extends Pick<PipelineServices, 'createFactory'> {
  logger?: AppLogger;
}

/**
 * The story of a create: the body names the id (there is no id in the path), the folder (shared
 * or local) and the wrapper skill must all be free, then the body as received (`raw`) becomes
 * `factories/<id>/pipeline.json`, the wrapper skill `factories-skills/<id>/SKILL.md` is written
 * and `.claude/skills/<id>` is linked to it.
 */
export const createPipelineFactory =
  ({ createFactory, logger }: CreatePipelineSettings) =>
  async (body: NewPipelineFile, raw: unknown): Promise<CreatePipelineResult> => {
    const result: CreatePipelineResult = await createFactory(body, raw);
    if (result.ok) logger?.info('factory created', { id: body.id, bytes: result.created.bytes });
    return result;
  };
