import type { z } from 'zod';
import type {
  edgeSchema,
  hooksSchema,
  modelSchema,
  pipelineSchema,
  scalarSchema,
  stepSchema,
} from './pipeline.schema.js';

// --- the file as written -----------------------------------------------------------------

export type Scalar = z.infer<typeof scalarSchema>;
export type ModelAlias = z.infer<typeof modelSchema>;
export type EdgeDefinition = z.infer<typeof edgeSchema>;
export type StepDefinition = z.infer<typeof stepSchema>;
export type HooksDefinition = z.infer<typeof hooksSchema>;
export type PipelineDefinition = z.infer<typeof pipelineSchema>;

/** A pipeline.json that parsed, and where it was read from. Nothing substituted yet. */
export interface LoadedPipeline {
  file: string;
  definition: PipelineDefinition;
  /** What is legal but worth a line in the log. */
  warnings: string[];
}

// --- what the resolver needs from the outside world ----------------------------------------

/** The absolute places the three anchor constants stand for. */
export interface PathAnchors {
  rootPath: string;
  skillPath: string;
  homePath: string;
}

/** Every outside fact resolution depends on, as plain data — so the resolver stays pure. */
export interface ResolveContext {
  anchors: PathAnchors;
  /** `YYYY-MM-DD`. */
  date: string;
  /** `name=value` arguments from the caller. They override `params`. */
  suppliedParams: Record<string, string>;
  /** Pins `{{slug}}` instead of deriving it from the main param — how a resumed run keeps its folder. */
  slug?: string;
}

// --- the file after resolution -------------------------------------------------------------

export type ParamValues = Record<string, Scalar>;

/** `{{name}}` → text. Complete: anchors, constants, params, id, slug, date and outputDir. */
export type Variables = Readonly<Record<string, string>>;

export interface ResolvedStep {
  name: string;
  agent: string;
  isHuman: boolean;
  model?: ModelAlias;
  prompt: string;
  systemPrompt?: string;
  /** Absolute paths or absolute glob patterns. */
  input: string[];
  output: string[];
  knowledge: string[];
  workDir: string;
  transitions: Record<string, EdgeDefinition>;
}

export interface ResolvedPipeline {
  id: string;
  description?: string;
  file: string;
  anchors: PathAnchors;
  outputDir: string;
  params: ParamValues;
  variables: Variables;
  hooks: HooksDefinition;
  start: string[];
  steps: Record<string, ResolvedStep>;
  warnings: string[];
}

// --- the usecase ---------------------------------------------------------------------------

export interface LoadPipelineRequest {
  /** A path to a pipeline.json, a folder holding one, or a factory id under `factories/`. */
  pipeline: string;
  /** Where the harness would have been launched from — the repository root. */
  rootPath: string;
  suppliedParams: Record<string, string>;
  slug?: string;
  date?: string;
}
