import type { z } from 'zod';
import type { systemMemorySchema } from './system.schema';

export type SystemMemory = z.infer<typeof systemMemorySchema>;

/** How full the memory looks: normal under 75 %, warning to 89 %, danger from 90 %. */
export type MemoryTone = 'normal' | 'warning' | 'danger';
