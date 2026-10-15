import type { AppLogger } from '../../../shared/types.js';
import type {
  PipelineFile,
  PipelineServices,
  ReadPipelineResult,
  SavePipelineResult,
} from '../pipelines.types.js';

export interface SavePipelineSettings extends Pick<
  PipelineServices,
  'readPipelineFile' | 'writePipelineFile'
> {
  logger?: AppLogger;
}

/**
 * The story of a save: the skill must already hold a `pipeline.json` (a save never creates
 * one), the body's `id` must name the skill in the path, then the body as received (`raw`,
 * not the validated copy) goes to disk.
 */
export const savePipelineFactory =
  ({ readPipelineFile, writePipelineFile, logger }: SavePipelineSettings) =>
  async (id: string, body: PipelineFile, raw: unknown): Promise<SavePipelineResult> => {
    const existing: ReadPipelineResult = await readPipelineFile(id);
    if (!existing.ok) return { ok: false, reason: 'not-found' };
    if (body.id !== id) return { ok: false, reason: 'id-mismatch' };
    const result: SavePipelineResult = await writePipelineFile(id, raw);
    if (result.ok) logger?.info('pipeline saved', { id, bytes: result.bytes });
    return result;
  };
