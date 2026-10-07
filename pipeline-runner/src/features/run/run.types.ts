import type { z } from 'zod';
import type { ModelAlias, ParamValues, Scalar } from '../pipeline/index.js';
import type { historyEventSchema, runStateSchema, stepRecordSchema } from './run.schema.js';

// --- the state file ------------------------------------------------------------------------

/** state.json, exactly as the dashboard and the cost report read it. Treated as immutable. */
export type RunState = z.infer<typeof runStateSchema>;
export type StepRecord = z.infer<typeof stepRecordSchema>;
export type HistoryEvent = z.infer<typeof historyEventSchema>;
export type RunStatus = RunState['status'];
export type StepStatus = StepRecord['status'];
export type Reported = Record<string, Scalar>;

/** Who routed into a step, so a revision pass can be told where its feedback lives. */
export interface Entry {
  from: string;
  event: string;
}

// --- ports: what the runner needs done, not who does it --------------------------------------

export interface AgentRequest {
  stepName: string;
  prompt: string;
  systemPrompt?: string;
  model?: ModelAlias;
  /** A custom agent profile, already known to exist. Absent means general-purpose. */
  agentProfile?: string;
  cwd: string;
  /** The run folder. An adapter that has to hand its harness a file keeps it under here. */
  runDir?: string;
  /** The keys of the step's `on`. The answer must be one of them. */
  allowedEvents: string[];
  /** Continue this session instead of opening a new one — how a wrong answer is asked again. */
  resumeSessionId?: string;
  signal?: AbortSignal;
}

/** What a harness reports instead of dollars. Every field is a sum, so two of these add up. */
export interface AgentUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  /** GitHub Copilot bills in premium requests. */
  premiumRequests?: number;
}

export interface AgentResult {
  /** Undefined when the agent finished without naming an event at all. */
  event?: string;
  reported: Reported;
  text: string;
  sessionId?: string;
  transcriptPath?: string;
  /** Only a harness that reports dollars sets this. Absent never means free. */
  costUsd?: number;
  usage?: AgentUsage;
  /**
   * True when `usage` counts the whole session so far, not this call alone — Copilot does that
   * on a resumed session. The retry's figure then replaces the first call's instead of adding.
   */
  usageCoversSession?: boolean;
  durationMs?: number;
}

export interface AgentPort {
  runAgent: (request: AgentRequest) => Promise<AgentResult>;
}

export interface HumanQuestion {
  stepName: string;
  question: string;
  /** Files worth reading before answering. */
  files: string[];
  allowedEvents: string[];
}

export interface HumanAnswer {
  event: string;
  note: string;
}

export interface HumanPort {
  ask: (question: HumanQuestion) => Promise<HumanAnswer>;
}

export interface ShellResult {
  command: string;
  exitCode: number;
  output: string;
}

export interface ShellPort {
  run: (command: string, cwd: string) => Promise<ShellResult>;
}

// --- one step's pass -------------------------------------------------------------------------

export interface PassInfo {
  /** 1 on the first pass. */
  pass: number;
  enteredBy?: Entry;
  /** Absolute output files of the step that sent this one back — where the feedback lives. */
  feedbackFiles: string[];
}

export interface KnowledgeText {
  file: string;
  text: string;
}

export interface InputListing {
  declared: string;
  /** What is really on disk right now. Empty means: not there on this pass. */
  files: string[];
}

export interface StepMaterials {
  knowledge: KnowledgeText[];
  /** Declared knowledge files that are not on disk. The step runs without them and says so. */
  missingKnowledge: string[];
  inputs: InputListing[];
}

export type StepOutcome =
  | {
      kind: 'event';
      step: string;
      event: string;
      reported: Reported;
      note: string;
      /** Files that really appeared, relative to the run folder. */
      outputs: string[];
      human: boolean;
      sessionId?: string;
      transcriptPath?: string;
      costUsd?: number;
      usage?: AgentUsage;
      durationMs?: number;
    }
  | { kind: 'error'; step: string; error: string };

// --- routing -------------------------------------------------------------------------------

export type RouteDecision =
  | {
      kind: 'routed';
      edge: string;
      targets: string[];
      /** Set when the cap was already spent and `onMax` stood in for `target`. */
      capped?: { max: number; onMax: string[] };
    }
  | { kind: 'refused'; edge: string; reason: string; capped?: { max: number; onMax: string[] } };

// --- the run ---------------------------------------------------------------------------------

export interface RunOptions {
  /** A step may start this many times in one run. A fuse: it fails the run, it never reroutes it. */
  maxStepPasses: number;
  signal?: AbortSignal;
}

export interface HookReport extends ShellResult {
  phase: 'before' | 'after';
}

export interface RunReport {
  status: RunStatus;
  runId: string;
  outputDir: string;
  stateFile: string;
  params: ParamValues;
  /** Every `step:EVENT` that routed to END. */
  endedBy: string[];
  /** Outputs of the steps that reached END. */
  deliverables: string[];
  failure?: string;
  capped: string[];
  skipped: { step: string; reason: string }[];
  failed: { step: string; error: string }[];
  passes: Record<string, number>;
  hooks: HookReport[];
  /** The harness the steps ran on, when the run recorded one. */
  harness?: string;
  costUsd: number;
  /** Tokens and premium requests, for the harnesses that report no dollars. */
  usage: AgentUsage;
}
