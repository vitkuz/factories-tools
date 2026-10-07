import { z } from 'zod';

const reportedSchema = z.record(z.string(), z.unknown());

/** What the step's agent must hand back: the event, and any values the task asked it to report. */
export const structuredAnswerSchema = z.object({
  event: z.string(),
  report: reportedSchema.nullish(),
});

export type StructuredAnswer = z.infer<typeof structuredAnswerSchema>;
