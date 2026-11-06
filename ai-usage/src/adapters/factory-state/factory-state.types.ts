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
   * Top-level folders (relative to the run dir) this step writes into: from the outputs the recorder
   * kept and the `output` globs of the run's pipeline.json snapshot. A step's folder need not carry
   * its name (`verify-lead-example-landing` → `7-verify-demo-landing/`), so this is the join key
   * between a subagent's files and the step, not the step name.
   */
  outputFolders: string[];
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
  /**
   * Provider session ids the run itself ran in (the orchestrator: `PIPELINE_INIT.details.sessionId`).
   * That session is the run's, exactly; its subagents are split over the steps by the heuristics.
   */
  sessionIds: string[];
};
