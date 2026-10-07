import os from 'node:os';
import path from 'node:path';
import { createSystemClock } from '../clients/clock/client.js';
import { createFileSystemClient } from '../clients/file-system/client.js';
import type { FileSystemClient } from '../clients/file-system/types.js';
import { createClaudeHarness } from '../clients/harness/claude/client.js';
import { CLAUDE_PERMISSION_MODES } from '../clients/harness/claude/types.js';
import type { ClaudePermissionMode } from '../clients/harness/claude/types.js';
import type { HarnessClient } from '../clients/harness/harness.types.js';
import { createScriptedHarness } from '../clients/harness/scripted/client.js';
import type { Script } from '../clients/harness/scripted/types.js';
import { createParkHuman } from '../clients/human/park/client.js';
import { createTerminalHuman } from '../clients/human/terminal/client.js';
import type { HumanClient, HumanMode } from '../clients/human/human.types.js';
import { createHexGenerator } from '../clients/ids/client.js';
import { createShellClient } from '../clients/shell/client.js';
import { createJsonlSink, createTerminalSink } from '../features/inspect/sinks/index.js';
import type { InspectSink } from '../features/inspect/inspect.types.js';
import type { RunOptions } from '../features/machines/machines.types.js';
import type { RunDeps } from '../features/run/run.types.js';
import env from '../shared/config/env.js';
import { projectRootFrom } from '../shared/config/paths.js';
import { logger } from '../shared/utils/logger.js';
import type { Result } from '../shared/types/result.types.js';
import { ok, refuse } from '../shared/utils/result.utils.js';
import type { EngineOptions } from './cli.utils.js';

const HOOK_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MAX_STEP_PASSES = 12;

/** What the command line decided about the engine, checked and typed. */
export interface Settings {
  rootPath: string;
  cwd: string;
  homePath: string;
  harness: string;
  permissionMode: ClaudePermissionMode;
  defaultModel?: string;
  humanMode: HumanMode;
  stepTimeoutMs: number;
  maxStepPasses: number;
  inspect?: 'terminal' | 'jsonl';
  script?: string;
}

const oneOf =
  <T extends string>(flag: string, names: readonly T[]) =>
  (value: string | undefined, fallback: T): Result<T> =>
    value === undefined
      ? ok(fallback)
      : (names as readonly string[]).includes(value)
        ? ok(value as T)
        : refuse(`${flag}-is-known`)(
            `${flag} does not take "${value}": one of ${names.join(', ')}`,
          );

/** Everything the flags and the environment say, in one typed record; a bad flag is a refusal. */
export const settingsOf = (options: EngineOptions, stdinIsTty: boolean): Result<Settings> => {
  const cwd: string = process.cwd();
  const rootPath: string = path.resolve(options.root ?? projectRootFrom(cwd));
  const permission = oneOf<ClaudePermissionMode>('--permission-mode', CLAUDE_PERMISSION_MODES)(
    options.permissionMode,
    env.PIPELINE_PERMISSION_MODE as ClaudePermissionMode,
  );
  if (!permission.ok) return permission;
  const human = oneOf<HumanMode>('--human', ['terminal', 'park'])(
    options.human,
    stdinIsTty ? 'terminal' : 'park',
  );
  if (!human.ok) return human;
  const inspect = oneOf<'terminal' | 'jsonl'>('--inspect', ['terminal', 'jsonl'])(
    options.inspect,
    'terminal',
  );
  if (!inspect.ok) return inspect;
  const minutes: number = Number(options.stepTimeout ?? env.STEP_TIMEOUT_MINUTES);
  const passes: number = Number(options.maxStepPasses ?? DEFAULT_MAX_STEP_PASSES);
  if (!Number.isFinite(minutes) || minutes <= 0)
    return refuse('step-timeout-is-minutes')('--step-timeout takes minutes');
  if (!Number.isInteger(passes) || passes < 1)
    return refuse('max-step-passes-is-count')('--max-step-passes takes a whole number');
  const defaultModel: string | undefined = options.defaultModel ?? env.PIPELINE_DEFAULT_MODEL;
  return ok({
    rootPath,
    cwd,
    homePath: os.homedir(),
    harness: options.harness ?? env.PIPELINE_HARNESS,
    permissionMode: permission.value,
    ...(defaultModel === undefined ? {} : { defaultModel }),
    humanMode: human.value,
    stepTimeoutMs: minutes * 60 * 1000,
    maxStepPasses: passes,
    ...(options.inspect === undefined ? {} : { inspect: inspect.value }),
    ...(options.script === undefined ? {} : { script: options.script }),
  });
};

export const runOptionsOf = (settings: Settings): RunOptions => ({
  harness: settings.harness,
  humanMode: settings.humanMode,
  stepTimeoutMs: settings.stepTimeoutMs,
  maxStepPasses: settings.maxStepPasses,
  sessionId: env.CLAUDE_SESSION_ID,
});

const readScript = (fileSystem: FileSystemClient, file: string | undefined): Script =>
  file === undefined ? {} : (JSON.parse(fileSystem.readText(file)) as Script);

/**
 * THE HARNESS REGISTRY. Adding a harness is one client folder under src/clients/harness/<name>/
 * and one line here; the engine never learns which one runs a step.
 */
const createHarnesses = (
  settings: Settings,
  fileSystem: FileSystemClient,
): Record<string, HarnessClient> => ({
  claude: createClaudeHarness({
    bin: env.CLAUDE_BIN,
    permissionMode: settings.permissionMode,
    ...(settings.defaultModel === undefined ? {} : { defaultModel: settings.defaultModel }),
    homePath: settings.homePath,
    logger,
  }),
  scripted: createScriptedHarness({
    script: readScript(fileSystem, settings.script),
    fileSystem,
    logger,
  }),
});

const createHuman = (settings: Settings): HumanClient =>
  settings.humanMode === 'terminal'
    ? createTerminalHuman({ input: process.stdin, output: process.stderr })
    : createParkHuman();

const createInspect = (
  settings: Settings,
  fileSystem: FileSystemClient,
): InspectSink | undefined => {
  if (settings.inspect === 'terminal') return createTerminalSink(logger);
  if (settings.inspect === 'jsonl')
    return createJsonlSink(fileSystem, path.join(settings.cwd, 'inspect.jsonl'));
  return undefined;
};

/** Ctrl-C stops the running steps and records the run so it can be resumed, not lost. */
const interruptSignal = (): AbortSignal => {
  const controller: AbortController = new AbortController();
  process.once('SIGINT', (): void => {
    logger.warn('interrupted: stopping the running steps and recording the run');
    controller.abort();
  });
  return controller.signal;
};

/** The one place where anything is wired to anything: real clients in, a RunDeps out. */
export const createDeps = (settings: Settings): RunDeps => {
  const fileSystem: FileSystemClient = createFileSystemClient();
  const inspect: InspectSink | undefined = createInspect(settings, fileSystem);
  return {
    fileSystem,
    clock: createSystemClock(),
    clockAfter: createSystemClock,
    newHex: createHexGenerator(),
    shell: createShellClient({ shell: 'bash', timeoutMs: HOOK_TIMEOUT_MS, logger }),
    harnesses: createHarnesses(settings, fileSystem),
    human: createHuman(settings),
    logger,
    rootPath: settings.rootPath,
    cwd: settings.cwd,
    homePath: settings.homePath,
    sessionId: env.CLAUDE_SESSION_ID,
    ...(inspect === undefined ? {} : { inspect }),
    signal: interruptSignal(),
  };
};
