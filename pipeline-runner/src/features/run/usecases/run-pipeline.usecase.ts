import type { FileSystemAdapter } from '../../../adapters/file-system/index.js';
import type { LoggerPort } from '../../../shared/types/logger.types.js';
import { createAppError } from '../../../shared/utils/error.utils.js';
import type { ResolvedPipeline } from '../../pipeline/index.js';
import type { Harness } from '../../harness/index.js';
import { failRun, markRunStarted, openRun, recordHarness, resumeRun } from '../run-state.utils.js';
import type {
  AgentPort,
  HookReport,
  HumanPort,
  RunOptions,
  RunReport,
  RunState,
  ShellPort,
} from '../run.types.js';
import {
  buildRunReport,
  createStateStore,
  driveRunFactory,
  executeAgentStepFactory,
  executeHumanStepFactory,
  hooksFailed,
  runHooksFactory,
  type StateStore,
} from '../services/index.js';

/** Every effect the runner has. Nothing below this line reaches for a global. */
export interface RunPipelineDeps {
  agent: AgentPort;
  /** The harness behind `agent`. Recorded in state.json, and used to find custom agents. */
  harness?: Harness;
  human: HumanPort;
  shell: ShellPort;
  fileSystem: FileSystemAdapter;
  logger: LoggerPort;
  now: () => Date;
  newId: () => string;
}

const runIdOf = (deps: RunPipelineDeps): string => {
  const stamp = deps.now().toISOString().replace(/[-:]/g, '').slice(0, 15);
  return `run-${stamp}-${deps.newId().replace(/-/g, '').slice(0, 6)}`;
};

/** What `run` and `resume` share: drive the graph to a stop, run the after hooks, read it back. */
const finishFactory =
  (deps: RunPipelineDeps, store: StateStore) =>
  (pipeline: ResolvedPipeline, options: RunOptions) =>
  async (state: RunState, before: HookReport[]): Promise<RunReport> => {
    const drive = driveRunFactory({
      executeAgentStep: executeAgentStepFactory(deps)(pipeline),
      executeHumanStep: executeHumanStepFactory(deps, deps.now)(pipeline),
      store,
      logger: deps.logger,
      now: deps.now,
    })(pipeline, options);

    const final: RunState = state.status === 'RUNNING' ? await drive(state) : state;
    // Whether the run succeeded or failed. A failure here is reported, never fatal.
    const after: HookReport[] = await runHooksFactory(deps)('after', pipeline.anchors.rootPath)(
      pipeline.hooks.after,
    );
    return buildRunReport(pipeline, final, [...before, ...after]);
  };

/**
 * run = create the run folder → open the state → before hooks → drive → after hooks → report.
 * A run folder that already holds a state file is never reused: that is what `resume` is for.
 */
export const runPipelineFactory =
  (deps: RunPipelineDeps) =>
  async (pipeline: ResolvedPipeline, options: RunOptions): Promise<RunReport> => {
    const store: StateStore = createStateStore(deps.fileSystem);
    if (await store.exists(pipeline.outputDir)) {
      throw createAppError('RUN_FOLDER_TAKEN', `${pipeline.outputDir} already holds a run`, [
        'resume it with: pipeline-runner resume <runDir>',
        'or start a separate one with: --slug <another-name>',
      ]);
    }
    await deps.fileSystem.makeDir(pipeline.outputDir);
    const at = (): string => deps.now().toISOString();
    const opened: RunState = recordHarness(deps.harness)(
      markRunStarted(at())(openRun(pipeline, runIdOf(deps), at())),
    );
    await store.save(pipeline.outputDir, opened);

    const before: HookReport[] = await runHooksFactory(deps)('before', pipeline.anchors.rootPath)(
      pipeline.hooks.before,
    );
    const state: RunState = hooksFailed(before)
      ? failRun(at())(`before hook failed: ${before.at(-1)?.command ?? ''}`)(opened)
      : opened;
    if (state !== opened) await store.save(pipeline.outputDir, state);

    return finishFactory(deps, store)(pipeline, options)(state, before);
  };

/**
 * resume = load the state → put what was running or failed back on the frontier → drive on.
 * Finished steps, edge counts and reported values stand; the before hooks are not run again.
 */
export const resumePipelineFactory =
  (deps: RunPipelineDeps) =>
  async (pipeline: ResolvedPipeline, options: RunOptions): Promise<RunReport> => {
    const store: StateStore = createStateStore(deps.fileSystem);
    const stopped: RunState = await store.load(pipeline.outputDir);
    if (stopped.status === 'COMPLETED') {
      throw createAppError('RUN_NOT_RESUMABLE', `${pipeline.outputDir} already completed`);
    }
    const state: RunState = recordHarness(deps.harness)(
      resumeRun(deps.now().toISOString())(stopped),
    );
    await store.save(pipeline.outputDir, state);
    return finishFactory(deps, store)(pipeline, options)(state, []);
  };

export type RunPipeline = ReturnType<typeof runPipelineFactory>;
