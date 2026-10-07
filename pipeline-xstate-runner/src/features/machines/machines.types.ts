import type {
  AgentRequest,
  AgentResult,
  AgentUsage,
  Reported,
} from '../../clients/harness/harness.types.js';
import type { HumanMode, HumanQuestion, HumanReply } from '../../clients/human/human.types.js';
import type { ShellResult } from '../../clients/shell/types.js';
import type {
  PathAnchors,
  Pipeline,
  ResolvedPipeline,
  ResolvedStep,
} from '../pipeline/pipeline.types.js';
import type { ValidationReport } from '../pipeline/services/validate-pipeline.service.js';
import type { Entry, PassInfo, StepMaterials } from '../prompt/prompt.types.js';
import type { Decision } from '../prompt/services/write-decision.service.js';
import type { State } from '../state/state.types.js';

/** Bumped whenever the run machine's context or states change shape: an older snapshot is refused. */
export const MACHINE_VERSION = 1;
export const RUNNER_NAME = 'pipeline-xstate-runner';

// --- what a run is started with --------------------------------------------------------------

export interface RunOptions {
  harness: string;
  humanMode: HumanMode;
  stepTimeoutMs: number;
  /** A step may start this many times in one run. A fuse: it fails the run, it never reroutes it. */
  maxStepPasses: number;
  /** CLAUDE_SESSION_ID, or '': recorded in PIPELINE_INIT as the recorder does. */
  sessionId: string;
}

export interface RunInput {
  /** Absolute path of the pipeline.json. */
  pipelineFile: string;
  rootPath: string;
  cwd: string;
  homePath: string;
  /** `-p name=value`, as given. */
  params: Record<string, string>;
  /** Six hex digits for the run id (the id's time part is the opening timestamp). */
  runHex: string;
  /** The `$schema` pointer written into state.json. */
  schemaRef: string;
  options: RunOptions;
}

export type HookPhase = 'before' | 'after';

export interface HookReport extends ShellResult {
  phase: HookPhase;
}

/** Who routed into a step last, and what they said: the brief of its next pass. */
export interface Entered extends Entry {
  note?: string;
}

/** The run machine's context. `state` is the state.json twin: every record lives there. */
export interface RunContext {
  input: RunInput;
  /** When the run opened: the moment validation finished. createdAt, and the run id's time part. */
  openedAt: string;
  validation?: ValidationReport;
  /** The pipeline as written, once it passed validation. */
  document?: Pipeline;
  pipeline?: ResolvedPipeline;
  state?: State;
  entered: Record<string, Entered>;
  hooks: HookReport[];
  /** Why nothing new starts: a failed step, a refused route, the fuse, an interruption. */
  halt?: string;
  /** Why the run never opened (validation or resolution failed): no run folder, nothing written. */
  error?: string;
}

export const INTERRUPTED = 'interrupted';

// --- the events the run machine takes ---------------------------------------------------------
// Every event carries `at`: the clock is read where the event is born (a client, an actor), never
// inside the machine, so replaying the recorded events reproduces state.json byte for byte.

export interface StepDoneEvent {
  type: 'STEP.DONE';
  step: string;
  pass: number;
  event: string;
  reported: Reported;
  /** Files that really appeared, relative to the run folder. */
  outputs: string[];
  note: string;
  human: boolean;
  sessionId?: string;
  transcriptPath?: string;
  costUsd?: number;
  usage?: AgentUsage;
  durationMs?: number;
  at: string;
}

export interface StepFailedEvent {
  type: 'STEP.FAILED';
  step: string;
  pass: number;
  error: string;
  at: string;
}

export interface StepTimedOutEvent {
  type: 'STEP.TIMED_OUT';
  step: string;
  pass: number;
  at: string;
}

export interface StepCancelledEvent {
  type: 'STEP.CANCELLED';
  step: string;
  pass: number;
  at: string;
}

export interface StepParkedEvent {
  type: 'STEP.PARKED';
  step: string;
  pass: number;
  ask: string;
  present: string[];
  at: string;
}

export interface HumanAnswerEvent {
  type: 'HUMAN.ANSWER';
  step: string;
  event: string;
  note: string;
  outputs: string[];
  at: string;
}

export interface CancelEvent {
  type: 'CANCEL';
  at: string;
}

export interface ResumeEvent {
  type: 'RESUME';
  at: string;
}

export type RunEvent =
  | StepDoneEvent
  | StepFailedEvent
  | StepTimedOutEvent
  | StepCancelledEvent
  | StepParkedEvent
  | HumanAnswerEvent
  | CancelEvent
  | ResumeEvent;

export type RunEventType = RunEvent['type'];

// --- the step actors --------------------------------------------------------------------------

export interface StepInput {
  step: ResolvedStep;
  pass: PassInfo;
  runDir: string;
  anchors: PathAnchors;
  stepTimeoutMs: number;
}

export type StepOutcome =
  | { kind: 'done' }
  | { kind: 'failed'; error: string }
  | { kind: 'timedOut' }
  | { kind: 'cancelled' };

export interface StepContext {
  input: StepInput;
  materials?: StepMaterials;
  /** The task message of the current call: the step's on the first, the retry's on the second. */
  prompt?: string;
  attempt: number;
  /** Every result the harness gave: the first call and, when needed, the retry. */
  answers: AgentResult[];
  outputs: string[];
  outcome?: StepOutcome;
  /** When the outcome was settled: read once, in `stamping`. */
  at?: string;
}

export type HumanOutcome =
  | { kind: 'answered' }
  | { kind: 'parked' }
  | { kind: 'failed'; error: string }
  | { kind: 'cancelled' };

export interface HumanContext {
  input: StepInput;
  materials?: StepMaterials;
  reply?: HumanReply;
  outputs: string[];
  outcome?: HumanOutcome;
  at?: string;
}

export type StepEvent = { type: 'CANCEL'; at: string };

// --- the effects the actors wrap: the only side effects a machine ever causes ----------------

export interface ValidateOutput {
  report: ValidationReport;
  /** The parsed pipeline, when the report is ok. */
  pipeline?: Pipeline;
  at: string;
}

export interface HooksOutput {
  reports: HookReport[];
  at: string;
}

export type RunStepOutput = { ok: true; result: AgentResult } | { ok: false; error: string };

/**
 * The machines' port to the world. Every function is backed by an injected client (file system,
 * harness, shell, human, clock) in the composition root; replay swaps in never-settling ones.
 */
export interface RunEffects {
  validate: (input: RunInput) => Promise<ValidateOutput>;
  makeRunDir: (dir: string) => Promise<void>;
  runHooks: (phase: HookPhase, cwd: string, commands: readonly string[]) => Promise<HooksOutput>;
  collectMaterials: (step: ResolvedStep, anchors: PathAnchors) => Promise<StepMaterials>;
  runStep: (request: AgentRequest, signal: AbortSignal) => Promise<RunStepOutput>;
  collectOutputs: (step: ResolvedStep, runDir: string) => Promise<string[]>;
  ask: (question: HumanQuestion, signal: AbortSignal) => Promise<HumanReply>;
  writeDecision: (step: ResolvedStep, decision: Decision) => Promise<void>;
  /** The clock: read once per settled outcome, so every event into the run machine carries `at`. */
  now: () => Promise<string>;
}
