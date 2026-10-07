// Learned from factories-tools/pipeline-state/src/features/state/state.types.ts
import type { z } from 'zod';
import type {
  historyEntrySchema,
  historyTypeSchema,
  pauseSchema,
  runStatusSchema,
  stateSchema,
  stepRecordSchema,
  stepStatusSchema,
} from './state.schema.js';

/** One run, as state.json holds it. */
export type State = z.infer<typeof stateSchema>;
export type StepRecord = z.infer<typeof stepRecordSchema>;
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
export type HistoryType = z.infer<typeof historyTypeSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type StepStatus = z.infer<typeof stepStatusSchema>;
export type Pause = z.infer<typeof pauseSchema>;

/** A history entry before the clock stamps it. */
export type HistoryDraft = Omit<HistoryEntry, 'timestamp'>;

/** One change to a run. Nothing is mutated: the state before in, the state after out. */
export type Transition = (state: State) => State;
