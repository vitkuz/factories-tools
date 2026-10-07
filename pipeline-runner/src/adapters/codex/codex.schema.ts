import { z } from 'zod';

/** One line of `codex exec --json`. Only what is read is named; every other event passes through. */
export const codexEventSchema = z.looseObject({
  type: z.string(),
  thread_id: z.string().optional(),
  message: z.string().optional(),
  error: z.looseObject({ message: z.string().optional() }).optional(),
  item: z.looseObject({ type: z.string().optional(), text: z.string().optional() }).optional(),
  usage: z
    .looseObject({
      input_tokens: z.number().optional(),
      cached_input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
    })
    .optional(),
});

export type CodexEvent = z.infer<typeof codexEventSchema>;
