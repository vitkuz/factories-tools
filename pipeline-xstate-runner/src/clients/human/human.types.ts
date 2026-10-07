// Learned from factories-tools/pipeline-runner/src/features/run/run.types.ts (HumanPort)
export interface HumanQuestion {
  stepName: string;
  question: string;
  /** Files worth reading before answering. */
  files: readonly string[];
  allowedEvents: readonly string[];
}

/** A person answered, or nobody is there to ask and the run parks until `answer` is called. */
export type HumanReply = { kind: 'answered'; event: string; note: string } | { kind: 'parked' };

export type HumanMode = 'terminal' | 'park';

export interface HumanClient {
  mode: HumanMode;
  ask: (question: HumanQuestion) => (signal: AbortSignal) => Promise<HumanReply>;
}
