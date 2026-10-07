// Learned from factories-tools/validation/src/features/pipeline/pipeline.types.ts and
// factories-tools/pipeline-runner/src/features/pipeline/pipeline.types.ts (the resolved shapes)
import type { z } from 'zod';
import type { edgeSchema, modelSchema, pipelineSchema, stepSchema } from './pipeline.schema.js';

// --- the file as written -------------------------------------------------------------------

export type Pipeline = z.infer<typeof pipelineSchema>;
export type Step = z.infer<typeof stepSchema>;
export type Edge = z.infer<typeof edgeSchema>;
export type ModelAlias = z.infer<typeof modelSchema>;

export type Scalar = string | number | boolean;

/** [event, edge] — one outgoing transition of a step. */
export type EdgeEntry = [string, Edge];

/** [jsonPath, text] — one string somewhere in the pipeline document. */
export type StringAt = [string, string];

// --- what resolution needs from the outside world --------------------------------------------

/** The absolute places the three anchor constants stand for. */
export interface PathAnchors {
  rootPath: string;
  skillPath: string;
  homePath: string;
}

/** Every outside fact resolution depends on, as plain data — so the resolver stays pure. */
export interface ResolveContext {
  anchors: PathAnchors;
  /** `YYYY-MM-DD`: the run's creation day. */
  date: string;
  /** `name=value` arguments from the caller. They override `params`. */
  suppliedParams: Readonly<Record<string, string>>;
}

// --- the file after resolution ---------------------------------------------------------------

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
  transitions: Record<string, Edge>;
}

export interface ResolvedHooks {
  before: string[];
  after: string[];
}

/** A pipeline with every `{{name}}` filled and every path made absolute: what a run follows. */
export interface ResolvedPipeline {
  id: string;
  /** Absolute path of the pipeline.json it came from. */
  file: string;
  anchors: PathAnchors;
  outputDir: string;
  params: ParamValues;
  constants: Record<string, Scalar>;
  variables: Variables;
  hooks: ResolvedHooks;
  start: string[];
  steps: Record<string, ResolvedStep>;
}
