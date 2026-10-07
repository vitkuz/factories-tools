import { z } from 'zod';

/** snapshot.json: the run machine's persisted snapshot, stamped with the shape it was written by. */
export const snapshotFileSchema = z.object({
  runner: z.string(),
  machineVersion: z.int(),
  snapshot: z.unknown(),
});

/** One line of events.jsonl: the n-th event the run machine received, as it received it. */
export const eventLineSchema = z.object({
  seq: z.int().min(1),
  event: z.object({ type: z.string() }).passthrough(),
});
