import type { LoggerPort } from '../../../shared/utils/logger.js';
import type { FileSystemClient } from '../../file-system/types.js';
import type { AgentUsage, Reported } from '../harness.types.js';

/** One scripted answer: what the fake subagent "did" and what it hands back. */
export interface ScriptedAnswer {
  /** The event returned; absent means the agent named none (the engine asks once more). */
  event?: string;
  report?: Reported;
  text?: string;
  sessionId?: string;
  costUsd?: number;
  usage?: AgentUsage;
  durationMs?: number;
  /** Files to write, relative to the run folder, before answering: the step's "outputs". */
  writes?: Record<string, string>;
  /** Answer only after this many milliseconds (real time): to order parallel outcomes in a test. */
  delayMs?: number;
  /** Throw with this message instead of answering: a step that could not be done. */
  fail?: string;
  /** Never answer: a step that hangs (for timeout and Ctrl-C tests). */
  hang?: boolean;
}

/** step name → its answers, one per call (a retry in the same session is the next call). */
export type Script = Readonly<Record<string, readonly ScriptedAnswer[]>>;

export interface ScriptedClientSettings {
  script: Script;
  fileSystem: Pick<FileSystemClient, 'writeText'>;
  logger?: LoggerPort;
}

/** Every request the fake received, in order: what a test asserts on. */
export interface ScriptedCall {
  step: string;
  prompt: string;
  systemPrompt?: string;
  model?: string;
  resumeSessionId?: string;
}
