import os from 'node:os';
import { v4 as uuid } from 'uuid';
import { createFileSystemAdapter, type FileSystemAdapter } from '../adapters/file-system/index.js';
import { createShellAdapter } from '../adapters/shell/index.js';
import { createTerminalAdapter } from '../adapters/terminal/index.js';
import type { Harness, PermissionMode, TierMap } from '../features/harness/index.js';
import { loadPipelineFactory, type LoadPipeline } from '../features/pipeline/index.js';
import {
  createStateStore,
  resumePipelineFactory,
  runPipelineFactory,
  type RunPipeline,
  type RunPipelineDeps,
} from '../features/run/index.js';
import env from '../shared/config/env.js';
import type { LoggerPort } from '../shared/types/logger.types.js';
import { logger } from '../shared/utils/logger.js';
import { createAgentAdapter } from './create-agent-adapter.js';

export interface ContainerOptions {
  harness?: Harness;
  permissionMode?: PermissionMode;
  stepTimeoutMinutes?: number;
  defaultModel?: string;
}

/** What can be had before a harness is chosen — `resume` reads the recorded one through it. */
export interface BaseContainer {
  logger: LoggerPort;
  fileSystem: FileSystemAdapter;
  stateStore: ReturnType<typeof createStateStore>;
}

export interface Container extends BaseContainer {
  harness: Harness;
  /** tier → model on the chosen harness; what `--harness` and the env's `*_MODELS` come to. */
  models: TierMap;
  loadPipeline: LoadPipeline;
  runPipeline: RunPipeline;
  resumePipeline: RunPipeline;
}

const HOOK_TIMEOUT_MS = 10 * 60 * 1000;

export const createBaseContainer = (): BaseContainer => {
  const fileSystem: FileSystemAdapter = createFileSystemAdapter({ logger });
  return { logger, fileSystem, stateStore: createStateStore(fileSystem) };
};

/**
 * The one place where anything is wired to anything. Adapters are built from settings, usecases
 * are built from adapters, and the commands receive the finished container. The `agent:` line is
 * the only place a harness adapter is chosen; a new harness is a new adapter folder and one more
 * entry in `createAgentAdapter`.
 */
export const createContainer = (options: ContainerOptions = {}): Container => {
  const now = (): Date => new Date();
  const { fileSystem, stateStore }: BaseContainer = createBaseContainer();
  const harness: Harness = options.harness ?? env.PIPELINE_HARNESS;
  const models: Record<Harness, TierMap> = {
    claude: env.CLAUDE_MODELS,
    codex: env.CODEX_MODELS,
    copilot: env.COPILOT_MODELS,
    agy: env.AGY_MODELS,
  };
  const defaultModel: string | undefined = options.defaultModel ?? env.PIPELINE_DEFAULT_MODEL;

  const deps: RunPipelineDeps = {
    agent: createAgentAdapter(harness, {
      bins: {
        claude: env.CLAUDE_BIN,
        codex: env.CODEX_BIN,
        copilot: env.COPILOT_BIN,
        agy: env.AGY_BIN,
      },
      models,
      permissionMode:
        options.permissionMode ?? env.PIPELINE_PERMISSION_MODE ?? env.CLAUDE_PERMISSION_MODE,
      timeoutMs: (options.stepTimeoutMinutes ?? env.STEP_TIMEOUT_MINUTES) * 60 * 1000,
      ...(defaultModel === undefined ? {} : { defaultModel }),
      homePath: os.homedir(),
      tempDir: os.tmpdir(),
      fileSystem,
      logger,
    }),
    harness,
    human: createTerminalAdapter({ input: process.stdin, output: process.stderr }),
    shell: createShellAdapter({ shell: 'bash', timeoutMs: HOOK_TIMEOUT_MS, logger }),
    fileSystem,
    logger,
    now,
    newId: uuid,
  };

  return {
    logger,
    fileSystem,
    stateStore,
    harness,
    models: models[harness],
    loadPipeline: loadPipelineFactory({ fileSystem, now, harness }),
    runPipeline: runPipelineFactory(deps),
    resumePipeline: resumePipelineFactory(deps),
  };
};
