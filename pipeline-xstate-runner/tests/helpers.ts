// Learned from factories-tools/pipeline-state/tests/{helpers,kit}.ts: a throwaway project the way a
// consumer has it (`factories` links to the kit), fixed clocks and ids, in-memory fakes.
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { SimulatedClock } from 'xstate';
import { createSteppingClock } from '../src/clients/clock/client.js';
import type { Clock } from '../src/clients/clock/types.js';
import { createFileSystemClient } from '../src/clients/file-system/client.js';
import type { FileSystemClient } from '../src/clients/file-system/types.js';
import { createScriptedHarness } from '../src/clients/harness/scripted/client.js';
import type { ScriptedHarness } from '../src/clients/harness/scripted/client.js';
import type { Script } from '../src/clients/harness/scripted/types.js';
import type { HumanClient, HumanQuestion, HumanReply } from '../src/clients/human/human.types.js';
import { createParkHuman } from '../src/clients/human/park/client.js';
import { createFixedHexGenerator } from '../src/clients/ids/client.js';
import { createShellClient } from '../src/clients/shell/client.js';
import type { RunOptions } from '../src/features/machines/machines.types.js';
import type { RunDeps, RunOutcome } from '../src/features/run/run.types.js';
import { runPipelineFactory } from '../src/features/run/usecases/run-pipeline.usecase.js';
import { statePathFor } from '../src/features/state/state.utils.js';
import { silentLogger } from '../src/shared/utils/logger.js';
import { loadJson, validateAgainstSchema } from './support/json-schema.js';

export const TOOL_ROOT: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** This repository (factories-tools): the tool lives at <tools>/pipeline-xstate-runner. */
export const TOOLS_ROOT: string = path.resolve(TOOL_ROOT, '..');
/** The kit (vitkuz/factories) as a project mounts it beside this repository: `<project>/factories`. */
export const FACTORIES_ROOT: string = path.resolve(TOOLS_ROOT, '..', 'factories');
/** The skills (vitkuz/factories-skills), mounted beside it at `<project>/factories-skills`. */
export const SKILLS_ROOT: string = path.resolve(TOOLS_ROOT, '..', 'factories-skills');

/** True when the sibling kit is there: the contract tests against its schemas and factories need it. */
export const hasSiblingKit = (): boolean =>
  existsSync(path.join(FACTORIES_ROOT, 'pipeline.schema.json'));

/** A suite that needs the sibling kit: one skipped placeholder when it is not mounted. */
export const describeWithKit = (name: string, body: () => void): void => {
  describe(name, () => {
    if (hasSiblingKit()) {
      body();
      return;
    }
    it.skip(`needs the kit mounted beside this repository at ${FACTORIES_ROOT}`, () => {});
  });
};
export const FIXTURES: string = path.join(TOOL_ROOT, 'fixtures');
export const START_AT = '2026-10-07T12:00:00Z';
export const HEX = 'abcdef';

export interface FixtureProject {
  root: string;
  remove: () => void;
}

/**
 * A throwaway project: `factories`, `factories-tools` and `factories-skills` link to the three
 * mounts (as the submodules would), `.claude/skills` exists, and every fixture pipeline is the
 * project's own under `factories.local/<id>/`.
 */
export const fixtureProject = (ids: readonly string[] = allFixtureIds()): FixtureProject => {
  const root: string = mkdtempSync(path.join(os.tmpdir(), 'xstate-runner-project-'));
  mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  symlinkSync(FACTORIES_ROOT, path.join(root, 'factories'), 'dir');
  symlinkSync(TOOLS_ROOT, path.join(root, 'factories-tools'), 'dir');
  symlinkSync(SKILLS_ROOT, path.join(root, 'factories-skills'), 'dir');
  for (const id of ids) {
    cpSync(path.join(FIXTURES, id), path.join(root, 'factories.local', id), { recursive: true });
    mkdirSync(path.join(root, '.claude', 'skills', id), { recursive: true });
  }
  return { root, remove: (): void => rmSync(root, { recursive: true, force: true }) };
};

export const allFixtureIds = (): string[] => createFileSystemClient().listDirectories(FIXTURES);

/** A person who answers from a list, in order. */
export const scriptedHuman = (
  replies: readonly HumanReply[],
): HumanClient & { asked: HumanQuestion[] } => {
  const queue: HumanReply[] = [...replies];
  const asked: HumanQuestion[] = [];
  return {
    mode: 'terminal',
    asked,
    ask: (question: HumanQuestion) => async (): Promise<HumanReply> => {
      asked.push(question);
      const reply: HumanReply | undefined = queue.shift();
      if (reply === undefined) throw new Error(`no scripted answer for "${question.stepName}"`);
      return reply;
    },
  };
};

export interface TestDeps extends RunDeps {
  harness: ScriptedHarness;
  delays: SimulatedClock;
  abort: () => void;
}

export interface TestDepsOptions {
  script?: Script;
  human?: HumanClient;
  clock?: Clock;
}

/** Real disk under the fixture project, a stepping clock, a fixed run id, the scripted harness. */
export const testDeps = (root: string, options: TestDepsOptions = {}): TestDeps => {
  const fileSystem: FileSystemClient = createFileSystemClient();
  const harness: ScriptedHarness = createScriptedHarness({
    script: options.script ?? {},
    fileSystem,
  });
  const delays = new SimulatedClock();
  const controller = new AbortController();
  return {
    fileSystem,
    clock: options.clock ?? createSteppingClock(START_AT)(),
    clockAfter: createSteppingClock(START_AT),
    newHex: createFixedHexGenerator(HEX),
    shell: createShellClient({ shell: 'bash', timeoutMs: 60_000 }),
    harnesses: { scripted: harness },
    human: options.human ?? createParkHuman(),
    logger: silentLogger,
    rootPath: root,
    cwd: root,
    homePath: path.join(root, 'home'),
    sessionId: '',
    delays,
    signal: controller.signal,
    harness,
    abort: (): void => controller.abort(),
  };
};

export const runOptions = (fields: Partial<RunOptions> = {}): RunOptions => ({
  harness: 'scripted',
  humanMode: 'park',
  stepTimeoutMs: 60 * 60 * 1000,
  maxStepPasses: 12,
  sessionId: '',
  ...fields,
});

/** Run a fixture by id in the project, on the scripted harness. */
export const runFixture = (
  deps: RunDeps,
  id: string,
  params: Record<string, string> = {},
  options: Partial<RunOptions> = {},
): Promise<RunOutcome> =>
  runPipelineFactory(deps)({ pipelineRef: id, params, options: runOptions(options) });

/** The run folder a fixture resolves to: <root>/run/<id>/<slug>-<date>. */
export const runDirOf = (root: string, id: string, slug: string = 'demo'): string =>
  path.join(root, 'run', id, `${slug}-${START_AT.slice(0, 10)}`);

export const readState = (runDir: string): Record<string, unknown> =>
  JSON.parse(readFileSync(statePathFor(runDir), 'utf8')) as Record<string, unknown>;

export const readStateText = (runDir: string): string => readFileSync(statePathFor(runDir), 'utf8');

const STATE_SCHEMA: Record<string, unknown> = hasSiblingKit()
  ? (loadJson(path.join(FACTORIES_ROOT, 'state.schema.json')) as Record<string, unknown>)
  : {};

/** The contract: state.json must satisfy factories/state.schema.json itself. */
export const schemaViolations = (runDir: string): string[] =>
  validateAgainstSchema(readState(runDir), STATE_SCHEMA);

/** A finished run's report, or the test fails with the refusal. */
export const reportOf = (outcome: RunOutcome): Extract<RunOutcome, { report: unknown }> => {
  if (outcome.kind === 'refused') throw new Error(`refused [${outcome.guard}]: ${outcome.message}`);
  return outcome;
};

export const historyTypes = (runDir: string): string[] =>
  ((readState(runDir)['history'] as { type: string }[] | undefined) ?? []).map(
    (entry) => entry.type,
  );

export const stepStatus = (runDir: string, step: string): string =>
  ((readState(runDir)['steps'] as Record<string, { status: string }>)[step] as { status: string })
    .status;
