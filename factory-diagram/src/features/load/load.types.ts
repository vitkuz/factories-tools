import type { z } from 'zod';
import type {
  edgeSchema,
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
export type PipelineDefinition = z.infer<typeof pipelineSchema>;

/** `{{name}}` → text, for every name the drawing can know before a run. */
export type Variables = Readonly<Record<string, string>>;

// --- what the shared validator said ---------------------------------------------------------

/** The `--json` report of the kit's `factories-tools/bin/validate.mjs`. */
export interface ValidatorReport {
  ok: boolean;
  pipeline: string;
  errors: string[];
  warnings: string[];
}

/**
 * The validator's findings sorted by what the drawing does with them: a fatal error stops the
 * tool; a dangling target or an unreachable step is drawn with a warning, as the Studio does;
 * a legacy prompt shape (string `prompt`, `systemPrompt`) is upgraded on read.
 */
export interface ValidationOutcome {
  fatal: string[];
  warnings: string[];
  unreachable: string[];
  dangling: string[];
}

// --- the file after loading ----------------------------------------------------------------

export interface LoadedPipeline {
  /** Absolute path of the pipeline.json. */
  file: string;
  /** The repository root `{{rootPath}}` stands for. */
  rootPath: string;
  definition: PipelineDefinition;
  /** Constants, non-empty param defaults, id, slug and the three anchors, fully expanded. */
  variables: Variables;
  /** `outputDir` with every known variable filled; `{{date}}` and empty params stay as written. */
  outputDir: string;
  /** Steps the validator found unreachable from START. */
  unreachable: string[];
  /** Everything legal but worth a line: validator warnings, dropped edges, legacy upgrade. */
  warnings: string[];
}

export interface LoadPipelineRequest {
  /** A factory id under `factories/`, a folder holding a pipeline.json, or the file itself. */
  pipeline: string;
  rootPath: string;
}
