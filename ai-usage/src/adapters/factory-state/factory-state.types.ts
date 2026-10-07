/** A pipeline run recorded by the factory's state tool, normalized across the two state-file shapes seen on disk. */
export type PipelineStep = {
  name: string;
  order: number;
  agent: string;
  status: string;
  passes: number;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
  outputs: string[];
  /**
   * Provider session ids this step's agent ran in, newest first — the runner records one per pass.
   * Ground truth: a headless step IS one provider session, so this beats any time-window guess.
   */
  sessionIds: string[];
  /** Every pass window, for steps that looped. */
  windows: Array<{ from: string; to: string }>;
};

export type PipelineRun = {
  /** Stable id: `<pipeline>/<run folder name>` */
  runId: string;
  pipeline: string;
  runDir: string;
  runFolder: string;
  root: string;
  status: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
  params: Record<string, unknown>;
  steps: PipelineStep[];
  stateFile: string;
};
