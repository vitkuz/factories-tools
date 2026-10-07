import type { z } from 'zod';
import type { DocumentAnswer } from '../documents/documents.types.js';
import type {
  discoveredPipelineSchema,
  newPipelineFileSchema,
  pipelineFileSchema,
} from './pipelines.schema.js';

export type PipelineFile = z.infer<typeof pipelineFileSchema>;
export type NewPipelineFile = z.infer<typeof newPipelineFileSchema>;
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

export interface SavedResponse {
  kind: 'saved';
  bytes: number;
}

export type ReadPipelineResult = { ok: true; file: string } | { ok: false; reason: 'not-found' };

export type SavePipelineResult =
  | { ok: true; bytes: number }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'id-mismatch' };

export type ReadKnowledgeResult =
  { ok: true; answer: DocumentAnswer } | { ok: false; reason: 'not-found' };

/** The answer of a create (E4b): the two files a new factory is made of, relative to `WORK_DIR`. */
export interface CreatedResponse {
  kind: 'created';
  id: string;
  /** `factories/<id>/pipeline.json` */
  path: string;
  /** `factories-skills/<id>/SKILL.md` (linked from `.claude/skills/<id>`) */
  skill: string;
  bytes: number;
}

export type CreatePipelineResult =
  { ok: true; created: CreatedResponse } | { ok: false; reason: 'exists'; existing: string };

export interface PipelineServices {
  listPipelineSkills: () => Promise<PipelineSkill[]>;
  readPipelineFile: (id: string) => Promise<ReadPipelineResult>;
  writePipelineFile: (id: string, raw: unknown) => Promise<SavePipelineResult>;
  createFactory: (body: NewPipelineFile, raw: unknown) => Promise<CreatePipelineResult>;
}

/** What `server.ts` hands the routes. */
export interface PipelineUsecases {
  listPipelines: () => Promise<PipelineListResponse>;
  readPipeline: (id: string) => Promise<ReadPipelineResult>;
  savePipeline: (id: string, body: PipelineFile, raw: unknown) => Promise<SavePipelineResult>;
  createPipeline: (body: NewPipelineFile, raw: unknown) => Promise<CreatePipelineResult>;
  readKnowledgeDocument: (id: string, rawPath: string) => Promise<ReadKnowledgeResult>;
}
