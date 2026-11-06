import { z } from 'zod';

/** `GET /api/v1/system/memory`: the API machine's memory (inside WSL2, the WSL VM's). */
export const systemMemorySchema = z.object({
  totalBytes: z.number().nonnegative(),
  usedBytes: z.number().nonnegative(),
  availableBytes: z.number().nonnegative(),
  usedPercent: z.number().min(0).max(100),
  loadAverage: z.array(z.number()),
  cpuCount: z.number(),
});

/** The `system` topic of the socket: the same reading, pushed every few seconds. */
export const systemMemoryMessageSchema = systemMemorySchema.extend({
  type: z.literal('system.memory'),
});
