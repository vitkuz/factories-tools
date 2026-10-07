import { z } from 'zod';
import { structuredAnswerSchema } from '../agent-shared/index.js';

/** The single JSON object `agy --print --output-format json` prints. Only what is read is named. */
export const agyResultSchema = z.looseObject({
  conversation_id: z.string().optional(),
  status: z.string().optional(),
  response: z.string().default(''),
  error: z.string().optional(),
  structured_output: structuredAnswerSchema.nullish().catch(undefined),
  duration_seconds: z.number().optional(),
  usage: z
    .looseObject({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      cache_read_tokens: z.number().optional(),
    })
    .optional(),
});

export type AgyResult = z.infer<typeof agyResultSchema>;
