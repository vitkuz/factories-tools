import type { z } from 'zod';
import type {
  factorySessionSchema,
  harnessSchema,
  pipelineListEntrySchema,
  pipelineListSchema,
  sessionListSchema,
  startSessionPayloadSchema,
  startedSessionSchema,
  stopSessionPayloadSchema,
  stoppedSchema,
} from './sessions.schema';

export type PipelineListEntry = z.infer<typeof pipelineListEntrySchema>;
export type PipelineList = z.infer<typeof pipelineListSchema>;

/** The load of the pipeline list the start form picks from. */
export type ListState = 'loading' | 'ready' | 'failed';

export type Harness = z.infer<typeof harnessSchema>;
export type FactorySession = z.infer<typeof factorySessionSchema>;
export type SessionList = z.infer<typeof sessionListSchema>;
export type StartedSession = z.infer<typeof startedSessionSchema>;
export type Stopped = z.infer<typeof stoppedSchema>;
export type StartSessionPayload = z.infer<typeof startSessionPayloadSchema>;
export type StopSessionPayload = z.infer<typeof stopSessionPayloadSchema>;

/** A message on the Sessions screen: what a start did, or why the API refused. */
export interface SessionNotice {
  tone: 'ok' | 'refusal';
  title: string;
  lines: string[];
}

export interface SessionsState {
  sessions: FactorySession[];
  /** When the list was last fetched successfully. */
  updatedAt: number;
  refreshing: boolean;
  /** The list could not be fetched; the last list stays on screen. */
  error: string | null;
  notice: SessionNotice | null;
}
