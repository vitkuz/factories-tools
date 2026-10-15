import { z } from 'zod';

/** What a listing needs from a `pipeline.json` on disk: an id and some steps. */
export const discoveredPipelineSchema = z.looseObject({
  id: z.string(),
  steps: z.record(z.string(), z.unknown()),
});
