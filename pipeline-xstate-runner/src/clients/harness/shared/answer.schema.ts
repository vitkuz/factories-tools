// Learned from factories-tools/pipeline-runner/src/adapters/agent-shared/answer.schema.ts
import { z } from 'zod';

/** What the step's agent must hand back: the event, and any values the task asked it to report. */
export const structuredAnswerSchema = z.object({
  event: z.string(),
  report: z.record(z.string(), z.unknown()).nullish(),
});

export type StructuredAnswer = z.infer<typeof structuredAnswerSchema>;
