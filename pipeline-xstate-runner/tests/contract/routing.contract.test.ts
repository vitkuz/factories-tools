/**
 * CONTRACT: for a routing scenario, this runner's state.json equals what the kit's recorder
 * (factories-tools/bin/state.mjs, run as an external process) records for the same sequence of
 * starts and events — timestamps, run ids and this runner's own fields normalised.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Script, ScriptedAnswer } from '../../src/clients/harness/scripted/types.js';
import {
  TOOLS_ROOT,
  fixtureProject,
  readState,
  reportOf,
  runDirOf,
  runFixture,
  testDeps,
} from '../helpers.js';

const project = fixtureProject();
afterAll(() => project.remove());

const STATE_MJS: string = path.join(TOOLS_ROOT, 'bin', 'state.mjs');

const state = (args: readonly string[]): Record<string, unknown> => {
  const stdout = execFileSync('node', [STATE_MJS, ...args], {
    cwd: project.root,
    encoding: 'utf8',
    env: { ...process.env, LOG_LEVEL: 'error', CLAUDE_SESSION_ID: '' },
  });
  return JSON.parse(stdout) as Record<string, unknown>;
};

interface Scenario {
  id: string;
  slug: string;
  params: Record<string, string>;
  script: Script;
  /** The person's answers at human steps, in order: [event, note]. */
  human?: [string, string][];
}

/** A scripted answer → the step-done flags the recorder takes. */
const flagsOf = (answer: ScriptedAnswer): string[] => [
  ...Object.keys(answer.writes ?? {}).flatMap((file: string): string[] => ['--output', file]),
  ...Object.entries(answer.report ?? {}).flatMap(([name, value]): string[] => [
    '--report',
    `${name}=${String(value)}`,
  ]),
];

/**
 * Drive state.mjs the way this runner's machine moves: start every ready step, then settle them in
 * the order they were started (the scripted harness answers in that order), and after each event
 * start whatever became ready.
 */
const driveRecorder = (scenario: Scenario, runDir: string): void => {
  const taken: Map<string, number> = new Map();
  const humans: [string, string][] = [...(scenario.human ?? [])];
  const next = (step: string): ScriptedAnswer => {
    const index: number = taken.get(step) ?? 0;
    taken.set(step, index + 1);
    const answer: ScriptedAnswer | undefined = scenario.script[step]?.[index];
    if (answer === undefined) throw new Error(`no answer #${index + 1} for ${step}`);
    return answer;
  };
  state([
    'open',
    scenario.id,
    runDir,
    ...Object.entries(scenario.params).flatMap(([k, v]) => ['--param', `${k}=${v}`]),
  ]);
  const started = state(['start', runDir]) as { ready: string[] };
  const pipeline = JSON.parse(
    require('node:fs').readFileSync(
      path.join(project.root, 'factories.local', scenario.id, 'pipeline.json'),
      'utf8',
    ),
  ) as { steps: Record<string, { agent: string; output?: string[] }> };

  const settle = (queue: readonly string[]): void => {
    const [step, ...rest] = queue;
    if (step === undefined) return;
    const human: boolean = pipeline.steps[step]?.agent === 'human';
    const result = human
      ? ((): Record<string, unknown> => {
          const [event, note] = humans.shift() ?? ['', ''];
          return state(['human', runDir, step, event, ...(note ? ['--note', note] : [])]);
        })()
      : ((): Record<string, unknown> => {
          const answer = next(step);
          return state(['step-done', runDir, step, answer.event ?? '', ...flagsOf(answer)]);
        })();
    const ready: string[] = (result as { ready: string[] }).ready;
    ready.forEach((name: string): void => void state(['start-step', runDir, name]));
    settle([...rest, ...ready]);
  };
  started.ready.forEach((name: string): void => void state(['start-step', runDir, name]));
  settle(started.ready);
  state(['finish', runDir]);
};

const TIMESTAMP: RegExp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** Timestamps, run ids and this runner's own fields taken out; the rest must be byte-equal. */
const normalise = (value: unknown): unknown => {
  if (typeof value === 'string')
    return TIMESTAMP.test(value)
      ? '<at>'
      : value.replace(/run-\d{8}T\d{6}-[0-9a-f]{6}/g, '<runId>');
  if (Array.isArray(value)) return value.map(normalise);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !['captured', 'sessionId', 'transcriptPath', 'costUsd', 'usage', 'durationMs'].includes(
              key,
            ),
        )
        .map(([key, entry]) => [key, normalise(entry)]),
    );
  }
  return value;
};

const done = (
  writes: Record<string, string>,
  extra: Partial<ScriptedAnswer> = {},
): ScriptedAnswer => ({ event: 'DONE', writes, ...extra });

const SCENARIOS: Scenario[] = [
  {
    id: 'linear',
    slug: 'demo',
    params: {},
    script: {
      a: [done({ '1-a/out.md': 'a' })],
      b: [done({ '2-b/out.md': 'b' })],
      c: [done({ '3-c/out.md': 'c' })],
    },
  },
  {
    id: 'diamond',
    slug: 'both',
    params: { topic: 'both' },
    script: {
      split: [{ event: 'BOTH', writes: { '1-split/out.md': 's' } }],
      left: [done({ '2-left/out.md': 'l' })],
      right: [done({ '2-right/out.md': 'r' })],
      join: [done({ '3-join/out.md': 'j' })],
    },
  },
  {
    id: 'diamond',
    slug: 'left',
    params: { topic: 'left' },
    script: {
      split: [{ event: 'LEFT', writes: { '1-split/out.md': 's' } }],
      left: [done({ '2-left/out.md': 'l' })],
      join: [done({ '3-join/out.md': 'j' })],
    },
  },
  {
    id: 'review-loop',
    slug: 'demo',
    params: {},
    script: {
      draft: [
        done({ '1-draft/draft.md': '1' }),
        done({ '1-draft/draft.md': '2' }),
        done({ '1-draft/draft.md': '3' }),
      ],
      review: [
        { event: 'REVISE', writes: { '2-review/review.md': 'a' } },
        { event: 'REVISE', writes: { '2-review/review.md': 'b' } },
        { event: 'REVISE', writes: { '2-review/review.md': 'c' } },
      ],
      polish: [done({ '3-polish/final.md': 'f' })],
    },
  },
  {
    id: 'condition',
    slug: 'many',
    params: { topic: 'many' },
    script: {
      count: [done({ '1-count/out.md': '3' }, { report: { findings: 3 } })],
      deep: [done({ '2-deep/out.md': 'd' })],
    },
  },
  {
    id: 'condition',
    slug: 'few',
    params: { topic: 'few' },
    script: { count: [done({ '1-count/out.md': '1' }, { report: { findings: 1 } })] },
  },
  {
    id: 'human-gate',
    slug: 'demo',
    params: {},
    script: { draft: [done({ '1-draft/draft.md': '1' }), done({ '1-draft/draft.md': '2' })] },
    human: [
      ['REJECT', 'shorter'],
      ['APPROVE', ''],
    ],
  },
];

describe('routing agrees with factories-tools/bin/state.mjs', () => {
  it.each(SCENARIOS.map((scenario) => [`${scenario.id} (${scenario.slug})`, scenario] as const))(
    '%s',
    async (_name, scenario) => {
      const recorderDir: string = path.join(
        project.root,
        'run-recorder',
        scenario.id,
        `${scenario.slug}-2026-10-07`,
      );
      driveRecorder(scenario, recorderDir);

      const human =
        scenario.human === undefined
          ? undefined
          : { kind: 'terminal' as const, answers: scenario.human };
      const deps = testDeps(project.root, {
        script: scenario.script,
        ...(human === undefined ? {} : { human: scriptedHumanOf(human.answers) }),
      });
      reportOf(
        await runFixture(deps, scenario.id, scenario.params, {
          humanMode: human === undefined ? 'park' : 'terminal',
        }),
      );

      expect(normalise(readState(runDirOf(project.root, scenario.id, scenario.slug)))).toEqual(
        normalise(readState(recorderDir)),
      );
    },
  );

  it('refuses a spent cap without onMax for the same reason, in the same words', async () => {
    const recorderDir: string = path.join(
      project.root,
      'run-recorder',
      'cap-no-onmax',
      'demo-2026-10-07',
    );
    state(['open', 'cap-no-onmax', recorderDir]);
    state(['start', recorderDir]);
    state(['start-step', recorderDir, 'draft']);
    state(['step-done', recorderDir, 'draft', 'DONE']);
    state(['start-step', recorderDir, 'review']);
    state(['step-done', recorderDir, 'review', 'REVISE']);
    state(['start-step', recorderDir, 'draft']);
    state(['step-done', recorderDir, 'draft', 'DONE']);
    state(['start-step', recorderDir, 'review']);
    const refusal = ((): string => {
      try {
        state(['step-done', recorderDir, 'review', 'REVISE']);
        return '';
      } catch (error: unknown) {
        return (error as { stderr: string }).stderr.trim();
      }
    })();
    const deps = testDeps(project.root, {
      script: { draft: [done({}), done({})], review: [{ event: 'REVISE' }, { event: 'REVISE' }] },
    });
    const outcome = reportOf(await runFixture(deps, 'cap-no-onmax'));
    expect(outcome.kind).toBe('failed');
    expect(refusal).toBe(
      'refused: edge review:REVISE was taken 1 time(s), its max, and has no onMax: the run stops here',
    );
    expect(outcome.report.failure).toContain(refusal.replace('refused: ', ''));
  });
});

/** The scripted person of the contract test: answers in order, nothing else. */
const scriptedHumanOf = (answers: readonly [string, string][]) => {
  const queue = [...answers];
  return {
    mode: 'terminal' as const,
    ask: () => async () => {
      const [event, note] = queue.shift() ?? ['', ''];
      return { kind: 'answered' as const, event, note };
    },
  };
};
