import type { z } from 'zod';
import type { eventLineSchema, snapshotFileSchema } from './persistence.schema.js';

export type SnapshotFile = z.infer<typeof snapshotFileSchema>;
export type EventLine = z.infer<typeof eventLineSchema>;

export const SNAPSHOT_FILE = 'snapshot.json';
export const EVENTS_FILE = 'events.jsonl';
