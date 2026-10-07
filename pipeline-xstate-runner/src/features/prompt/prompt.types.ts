// Learned from factories-tools/pipeline-runner/src/features/run/run.types.ts (PassInfo, StepMaterials)
/** Who routed into a step, so a revision pass can be told where its feedback lives. */
export interface Entry {
  from: string;
  event: string;
}

export interface PassInfo {
  /** 1 on the first pass. */
  pass: number;
  enteredBy?: Entry;
  /** Absolute output files of the step that sent this one back — where the feedback lives. */
  feedbackFiles: string[];
  /** What a person added when their answer sent the work back (the note of a human step). */
  revisionNote?: string;
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

/** Everything a step's task message is made of that lives on disk, read at the start of a pass. */
export interface StepMaterials {
  knowledge: KnowledgeText[];
  /** Declared knowledge files that are not on disk. The step runs without them and says so. */
  missingKnowledge: string[];
  inputs: InputListing[];
  /** The custom agent profile found for the step, when it names one that exists. */
  agentProfile?: string;
  /** What the step ran without: the record keeps it as the pass's note. */
  notes: string[];
}
