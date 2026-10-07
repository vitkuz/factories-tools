import type { SimulatedClock } from 'xstate';
import type { Clock, ClockFactory } from '../../clients/clock/types.js';
import type { FileSystemClient } from '../../clients/file-system/types.js';
import type { AgentUsage, HarnessClient } from '../../clients/harness/harness.types.js';
import type { HumanClient } from '../../clients/human/human.types.js';
import type { HexGenerator } from '../../clients/ids/types.js';
import type { ShellClient } from '../../clients/shell/types.js';
import type { LoggerPort } from '../../shared/utils/logger.js';
import type { InspectSink } from '../inspect/inspect.types.js';
import type { HookReport, RunOptions } from '../machines/machines.types.js';
import type { ParamValues } from '../pipeline/pipeline.types.js';
import type { RunStatus, State } from '../state/state.types.js';

/** XState's clock for delayed transitions (`after`): what SimulatedClock implements in tests. */
export type DelayClock = Pick<SimulatedClock, 'setTimeout' | 'clearTimeout'>;

/** Every effect a run has, injected. Wired once, in the composition root. */
export interface RunDeps {
  fileSystem: FileSystemClient;
  /** Timestamps; `clockAfter` seeds a clock after a resumed run's last write. */
  clock: Clock;
  clockAfter: ClockFactory;
  newHex: HexGenerator;
  shell: ShellClient;
  /** THE HARNESS REGISTRY: every installed harness by name. */
  harnesses: Readonly<Record<string, HarnessClient>>;
  human: HumanClient;
  logger: LoggerPort;
  rootPath: string;
  cwd: string;
  homePath: string;
  /** CLAUDE_SESSION_ID, or ''. */
  sessionId: string;
  /** XState's clock for `after` delays: real timers by default, simulated in tests. */
  delays?: DelayClock;
  inspect?: InspectSink;
  /** Ctrl-C: aborting it cancels the running steps and parks the run as ABORTED. */
  signal?: AbortSignal;
}

export interface RunRequest {
  /** An id (factories.local/<id>, then factories/<id>), a folder or a pipeline.json. */
  pipelineRef: string;
  params: Record<string, string>;
  options: RunOptions;
}

/** The run read back from its own record — never from what the runner remembers doing. */
export interface RunReport {
  status: RunStatus;
  runId: string;
  runDir: string;
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
  harness?: string;
  costUsd: number;
  usage: AgentUsage;
  /** Set when the run waits for a person: what is asked and what they may answer. */
  awaiting?: { step: string; ask: string; events: string[]; present: string[] };
}

/** How a run ended, for the caller: the report, and what to tell the shell. */
export type RunOutcome =
  | { kind: 'completed' | 'failed' | 'stopped' | 'parked'; report: RunReport; state: State }
  /** The run never opened: nothing was written. */
  | { kind: 'refused'; guard: string; message: string };
