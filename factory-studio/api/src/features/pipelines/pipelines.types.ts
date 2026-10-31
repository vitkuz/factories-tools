import type { z } from 'zod';
import type {
  DocumentAnswer,
  ParsedDocPath,
  WriteAnswer,
  WriteGuard,
} from '../documents/documents.types.js';
import type {
  discoveredPipelineSchema,
  factoryParamSchema,
  paramInfoSchema,
  paramInputSchema,
  paramValueSchema,
} from './pipelines.schema.js';

export type DiscoveredPipeline = z.infer<typeof discoveredPipelineSchema>;
export type ParamValue = z.infer<typeof paramValueSchema>;
export type FactoryParam = z.infer<typeof factoryParamSchema>;
export type ParamInfo = z.infer<typeof paramInfoSchema>;
export type ParamInput = z.infer<typeof paramInputSchema>;

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
  /** `pipeline.params` in declaration order, typed for the start form. */
  params: FactoryParam[];
  /** `pipeline.description`, when it is a non-empty string. */
  description?: string;
}

export interface PipelineListResponse {
  pipelines: PipelineListEntry[];
}

/** The answer of a document write: a run document (E8) or a factory's knowledge (E16). */
export interface SavedResponse {
  kind: 'saved';
  bytes: number;
  /** The ETag of the bytes now on disk: the `If-Match` of the next save. */
  etag: string;
}

export type ReadKnowledgeResult =
  { ok: true; answer: DocumentAnswer } | { ok: false; reason: 'not-found' };

export type WriteKnowledgeResult =
  { ok: true; answer: WriteAnswer } | { ok: false; reason: 'not-found' };

/** A knowledge path resolved the way E5 reads it, so E16 writes exactly what was shown. */
export type ResolvedKnowledgePath =
  | { ok: true; skill: PipelineSkill; base: string; parsed: ParsedDocPath }
  | { ok: false; reason: 'not-found' }
  | { ok: false; refused: { status: 400; error: string } };

/** Where E16 may write a knowledge file: the real knowledge folder and the path under it. */
export type WritableKnowledge =
  { ok: true; base: string; parsed: ParsedDocPath } | { ok: false; status: 403; error: string };

/**
 * The app lists pipelines and reads their knowledge; it never writes a pipeline, only the
 * knowledge files of the project's own factories (E16).
 */
export interface PipelineServices {
  listPipelineSkills: () => Promise<PipelineSkill[]>;
}

/** `null`: no pipeline with that id is listed. */
export type ReadFactoryParams = (id: string) => Promise<FactoryParam[] | null>;

/** What `server.ts` hands the routes. */
export interface PipelineUsecases {
  listPipelines: () => Promise<PipelineListResponse>;
  readKnowledgeDocument: (id: string, rawPath: string) => Promise<ReadKnowledgeResult>;
  writeKnowledgeDocument: (
    id: string,
    rawPath: string,
    text: string,
    guard: WriteGuard,
  ) => Promise<WriteKnowledgeResult>;
}
