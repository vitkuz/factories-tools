// Learned from factories-tools/pipeline-runner/src/adapters/claude/claude.schema.ts
import { z } from 'zod';
import { structuredAnswerSchema } from '../shared/answer.schema.js';

/** The single JSON object `claude -p --output-format json` prints. Only what is read is named. */
export const claudeResultSchema = z.looseObject({
  type: z.literal('result'),
  subtype: z.string().optional(),
  is_error: z.boolean().default(false),
  result: z.string().default(''),
  session_id: z.string().optional(),
  total_cost_usd: z.number().optional(),
  duration_ms: z.number().optional(),
  structured_output: structuredAnswerSchema.nullish(),
});

export type ClaudeResult = z.infer<typeof claudeResultSchema>;
