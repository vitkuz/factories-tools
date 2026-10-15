import {
  END_ID,
  START_ID,
  type GraphEdge,
  type GraphNodeOf,
  type StepCardData,
  type StepNodeOf,
} from '../../../shared/graph';

/** Reserved terminal target. Never a step name. */
export const END = 'END' as const;

/** Node ids of the two terminals on the canvas — the shared graph's. */
export const START_NODE_ID: string = START_ID;
export const END_NODE_ID: string = END_ID;

/** One edge out of a step: `"DONE": { "target": ["review"] }`. */
export interface PipelineEdge {
  target: string[];
  max?: number;
  onMax?: string[];
  condition?: string;
}

/** One node of the graph — a single subagent, or a `human` pause. */
export interface PipelineStep {
  agent: string;
  /** System prompt lines; the text is the lines joined with "\n". */
  system?: string[];
  /** Prompt lines; the text is the lines joined with "\n". */
  prompt: string[];
  knowledge?: string[];
  workDir?: string;
  input?: string[];
  output?: string[];
  transitions: Record<string, PipelineEdge>;
  /** The order this step's keys had in its file; see `Pipeline.keyOrder`. */
  keyOrder?: string[];
  /** Keys of the step the editor does not model (a `timeout`, a `model`); written back untouched. */
  extras?: Record<string, unknown>;
}

/** A param or constant value: the schema allows a string, a number or a boolean for both. */
export type ScalarValue = string | number | boolean;

export interface Pipeline {
  $schema?: string;
  id: string;
  description?: string;
  /** The anchors are strings; a factory may add numbers (`articles: 3`) and booleans. */
  constants: Record<string, ScalarValue>;
  params: Record<string, ScalarValue>;
  outputDir: string;
  START: string[];
  steps: Record<string, PipelineStep>;
  /**
   * The order the top-level keys had in the file this came from, so an export
   * of an unchanged pipeline is byte-for-byte the file that was loaded. Never
   * written out itself.
   */
  keyOrder?: string[];
  /** Top-level keys of the file the editor does not model, such as `hooks`; written back untouched. */
  extras?: Record<string, unknown>;
}

/** A step card on the editor canvas: the shared card data, plus how many checks flag the step. */
export interface StepNodeData extends StepCardData {
  issueCount: number;
}

export type StepFlowNode = StepNodeOf<StepNodeData>;
export type FlowNode = GraphNodeOf<StepNodeData>;

/** An edge on the canvas; `data.routes` says which `transitions` entries it draws. */
export type FlowEdge = GraphEdge;

export type IssueLevel = 'error' | 'warning';

export interface Issue {
  level: IssueLevel;
  where: string;
  message: string;
  /** Step name or edge id the issue belongs to, for highlighting on the canvas. */
  subject?: string;
}

/** What the inspector panel is currently editing. */
export type Selection =
  | { kind: 'pipeline' }
  | { kind: 'step'; name: string }
  | { kind: 'edge'; source: string; event: string };

/** Read-only viewing, or editing. */
export type Mode = 'view' | 'edit';

/** How much of a step a node shows. */
export type Density = 'full' | 'compact';

/** An immutable undo stack: what came before, what is, what was undone. */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

/** An agent type a step can name: a built-in, or a profile under `.ai/back/agents/`. */
export interface AgentProfile {
  name: string;
  description: string;
}

/** Build a pipeline from nothing, or add a step to the one that is open. */
export type WizardMode = 'new' | 'extend';

export type WizardScreen = 'pipeline' | 'steps' | 'wiring' | 'review';

/** A pipeline loaded as a source of blocks, never edited itself. */
export interface Reference {
  /** Unique within the library: the pipeline id, suffixed when two collide. */
  key: string;
  filename: string;
  pipeline: Pipeline;
}

/** Where an imported step came from, so later imports from the same reference reconnect. */
export interface Provenance {
  reference: string;
  original: string;
}

export type ProvenanceMap = Record<string, Provenance>;

/** What lands in the pipeline after a block is imported. */
export interface ImportResult {
  pipeline: Pipeline;
  name: string;
  provenance: ProvenanceMap;
}

/** The payload a dragged block carries. */
export interface BlockDrag {
  reference: string;
  step: string;
}

export const BLOCK_DRAG_TYPE = 'application/x-pipeline-block';
