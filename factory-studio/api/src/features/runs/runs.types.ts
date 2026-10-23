import type { z } from 'zod';
import type { DocumentAnswer, WriteAnswer } from '../documents/documents.types.js';
import type { DiscoveredPipeline } from '../pipelines/pipelines.types.js';
import type { FactorySession } from '../sessions/sessions.types.js';
import type {
  costFileSchema,
  runParamsSchema,
  runSessionStampSchema,
  runStateFileSchema,
  sessionRunLinkSchema,
} from './runs.schema.js';

export type RunStateFile = z.infer<typeof runStateFileSchema>;
export type CostFile = z.infer<typeof costFileSchema>;
export type RunSessionStamp = z.infer<typeof runSessionStampSchema>;
export type SessionRunLink = z.infer<typeof sessionRunLinkSchema>;
export type RunParams = z.infer<typeof runParamsSchema>;

/** What is known about the session that asks: its Claude session id, and its studio meta. */
export interface SessionRunQuery {
  /** The harness's own session id, from the question hook; the recorder stamps runs with it. */
  claudeSessionId?: string;
  /** From the studio's session meta: only a session the studio started has these. */
  factoryId?: string;
  startedAt?: string;
}

/** One `run/<pipelineId>/<runId>` folder, as the app's run-list parser expects it. */
export interface RunRecord {
  runId: string;
  pipelineId: string;
  /** Relative to `WORK_DIR`, `/` separators. */
  dir: string;
  hasState: boolean;
  state: RunStateFile | null;
  cost: CostFile | null;
  hasCost: boolean;
  /** The run's own `pipeline.json` snapshot, when it has one. */
  pipeline?: DiscoveredPipeline;
}

export interface RunsPayload {
  generatedAt: string;
  pipelines: Record<string, DiscoveredPipeline>;
  runs: RunRecord[];
}

export type ReadRunDocumentResult =
  { ok: true; answer: DocumentAnswer } | { ok: false; reason: 'run-not-found' };

export type WriteRunDocumentResult =
  { ok: true; answer: WriteAnswer } | { ok: false; reason: 'run-not-found' };

/** A run folder that may be moved: a real folder, straight under `run/<folder>/`. */
export interface RemovableRunDir {
  /** Absolute. */
  dir: string;
  /** The folder under `run/` it is filed in: normally the pipeline id. */
  folder: string;
}

export type LocateRemovableRunResult =
  | { ok: true; run: RemovableRunDir }
  | { ok: false; reason: 'not-found' }
  /** A symlink, or a path that resolves somewhere else than where it is listed. */
  | { ok: false; reason: 'refused'; message: string };

/** What `DELETE /runs/:pipelineId/:runId` answers on success. Paths relative to `WORK_DIR`. */
export interface RemovedRun {
  pipelineId: string;
  runId: string;
  from: string;
  /** Where the folder is now: `run/.trash/<folder>/<runId>-<stamp>`. Restore = move it back. */
  trashedTo: string;
}

/** The live session list, or why it could not be read. */
export type SessionsRead =
  { ok: true; sessions: FactorySession[] } | { ok: false; message: string };

export type RemoveRunResult =
  | { ok: true; removed: RemovedRun }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'refused'; message: string }
  /** A studio session that is still alive in herdr is writing this run. */
  | { ok: false; reason: 'live-session'; session: string }
  /** The session list could not be read, so a live session cannot be ruled out. */
  | { ok: false; reason: 'sessions-unknown'; message: string };

export interface RunServices {
  collectRunRecords: () => Promise<RunRecord[]>;
  /** The absolute run folder, or `null` when there is no such run. */
  locateRunDir: (pipelineId: string, runId: string) => Promise<string | null>;
  /** The run folder checked for a move: no symlink, resolved where it is listed. */
  locateRemovableRun: (pipelineId: string, runId: string) => Promise<LocateRemovableRunResult>;
  /** Move the folder into `run/.trash`; returns the new absolute path. */
  moveRunToTrash: (run: RemovableRunDir, runId: string) => Promise<string>;
}

/** What `server.ts` hands the routes. */
export interface RunUsecases {
  listRuns: () => Promise<RunsPayload>;
  readRunDocument: (
    pipelineId: string,
    runId: string,
    rawPath: string,
  ) => Promise<ReadRunDocumentResult>;
  writeRunDocument: (
    pipelineId: string,
    runId: string,
    rawPath: string,
    text: string,
  ) => Promise<WriteRunDocumentResult>;
  /** Moves the run to `run/.trash`, unless a live session is still in it. */
  removeRun: (pipelineId: string, runId: string) => Promise<RemoveRunResult>;
}
