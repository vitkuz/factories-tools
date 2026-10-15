import type { z } from 'zod';
import type { DocumentAnswer } from '../documents/documents.types.js';
import type { discoveredPipelineSchema } from './pipelines.schema.js';

export type DiscoveredPipeline = z.infer<typeof discoveredPipelineSchema>;

/** One `factories/<id>/pipeline.json` as found on disk. */
export interface PipelineSkill {
  /** The directory name. */
  id: string;
  /** Absolute folder holding `pipeline.json` (`factories/<id>/` or `factories.local/<id>/`, what `{{factoryPath}}` names). */
  dir: string;
  /** Absolute `pipeline.json`. */
  file: string;
  /** `pipeline.json` relative to `WORK_DIR`, `/` separators. */
  path: string;
  pipeline: DiscoveredPipeline;
}

export interface PipelineListEntry {
  id: string;
  path: string;
  pipeline: DiscoveredPipeline;
}

export interface PipelineListResponse {
  pipelines: PipelineListEntry[];
}

/** The answer of a run document write (E8). */
export interface SavedResponse {
  kind: 'saved';
  bytes: number;
}

export type ReadKnowledgeResult =
  { ok: true; answer: DocumentAnswer } | { ok: false; reason: 'not-found' };

/** Read-only: the app lists pipelines and reads their knowledge, it never writes a pipeline. */
export interface PipelineServices {
  listPipelineSkills: () => Promise<PipelineSkill[]>;
}

/** What `server.ts` hands the routes. */
export interface PipelineUsecases {
  listPipelines: () => Promise<PipelineListResponse>;
  readKnowledgeDocument: (id: string, rawPath: string) => Promise<ReadKnowledgeResult>;
}
