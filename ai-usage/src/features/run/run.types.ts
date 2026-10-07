import type { RunUsageSummary } from "../../contract/usage-summary.types.js";
import type { IngestSettings } from "../ingest/index.js";

export type RunWrappedSettings = IngestSettings & {
  /** argv of the CLI to execute, e.g. ["claude", "-p", "hi"]. */
  command: string[];
  cwd: string;
  customer?: string;
  label?: string;
};

export type RunWrappedResult = {
  /** Exit code of the wrapped command; 1 when it died on a signal. */
  exitCode: number;
  /** Runs that gained usage in `cwd` while the command was running. */
  runs: RunUsageSummary[];
};
