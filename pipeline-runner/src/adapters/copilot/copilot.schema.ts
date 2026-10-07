import { z } from 'zod';

/**
 * One line of `copilot --output-format json`. Most lines are `session.*` noise; two are read:
 * `assistant.message` (one per turn) and the closing `result`.
 */
export const copilotEventSchema = z.looseObject({
  type: z.string(),
  data: z.looseObject({ content: z.string().optional() }).optional(),
  sessionId: z.string().optional(),
  exitCode: z.number().optional(),
  usage: z
    .looseObject({
      premiumRequests: z.number().optional(),
      sessionDurationMs: z.number().optional(),
    })
    .optional(),
});

export type CopilotEvent = z.infer<typeof copilotEventSchema>;
