import type { z } from 'zod';
import type { DocumentAnswer, WriteAnswer } from '../documents/documents.types.js';
import type { DiscoveredPipeline } from '../pipelines/pipelines.types.js';
import type { costFileSchema, runStateFileSchema } from './runs.schema.js';

export type RunStateFile = z.infer<typeof runStateFileSchema>;
export type CostFile = z.infer<typeof costFileSchema>;

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

export interface RunServices {
  collectRunRecords: () => Promise<RunRecord[]>;
  /** The absolute run folder, or `null` when there is no such run. */
  locateRunDir: (pipelineId: string, runId: string) => Promise<string | null>;
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
}
