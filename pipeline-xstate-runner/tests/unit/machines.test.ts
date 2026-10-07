/**
 * The run machine, its step actors and the routing guards, driven through the usecases on the
 * scripted harness. Every produced state.json is checked against factories/state.schema.json.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Script } from '../../src/clients/harness/scripted/types.js';
import { answerHumanFactory } from '../../src/features/run/usecases/answer-human.usecase.js';
import { replayRunFactory } from '../../src/features/run/usecases/replay-run.usecase.js';
import { resumeRunFactory } from '../../src/features/run/usecases/resume-run.usecase.js';
import { valueOf } from '../../src/shared/utils/result.utils.js';
import {
  fixtureProject,
  historyTypes,
  readState,
  readStateText,
  reportOf,
  runDirOf,
  runFixture,
  schemaViolations,
  scriptedHuman,
  stepStatus,
  testDeps,
} from '../helpers.js';

const project = fixtureProject();
afterAll(() => project.remove());

const done = (writes: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  event: 'DONE',
  writes,
  ...extra,
});

const expectValid = (runDir: string): void => expect(schemaViolations(runDir)).toEqual([]);

const expectReplays = (runDir: string): void => {
  const replay = valueOf(replayRunFactory(testDeps(project.root))(runDir));
  expect(replay.matches, replay.rebuilt ?? '').toBe(true);
};

describe('a linear run', () => {
  const script: Script = {
    a: [done({ '1-a/out.md': 'a' }, { sessionId: 's-a', costUsd: 0.5, durationMs: 10 })],
    b: [done({ '2-b/out.md': 'b' }, { costUsd: 0.25 })],
    c: [done({ '3-c/out.md': 'c' })],
  };

  it('completes, records every pass, and its files obey the contract', async () => {
    const deps = testDeps(project.root, { script });
    const outcome = reportOf(await runFixture(deps, 'linear'));
    const runDir = runDirOf(project.root, 'linear');
    expect(outcome.kind).toBe('completed');
    expect(outcome.report).toMatchObject({
      status: 'COMPLETED',
      endedBy: ['c:DONE'],
      deliverables: ['3-c/out.md'],
      costUsd: 0.75,
    });
    const state = readState(runDir);
    expect(state['status']).toBe('COMPLETED');
    expect((state['steps'] as Record<string, { sessionId?: string }>)['a']?.sessionId).toBe('s-a');
    expect(state['edges']).toEqual({ 'a:DONE': 1, 'b:DONE': 1, 'c:DONE': 1 });
    expect(historyTypes(runDir)).toEqual([
      'PIPELINE_INIT',
      'WAVE_START',
      'STEP_START',
      'STEP_EVENT',
      'STEP_START',
      'STEP_EVENT',
      'STEP_START',
      'STEP_EVENT',
      'PIPELINE_COMPLETE',
    ]);
    expect(existsSync(path.join(runDir, 'events.jsonl'))).toBe(true);
    expect(existsSync(path.join(runDir, 'snapshot.json'))).toBe(true);
    expectValid(runDir);
    expectReplays(runDir);
    // the task message followed runner.md: prompt, inputs, outputs, working directory, events
    const prompt = deps.harness.calls()[1]?.prompt ?? '';
    expect(prompt.indexOf('Do b.')).toBeLessThan(prompt.indexOf('## Input files'));
    expect(prompt.indexOf('## Input files')).toBeLessThan(prompt.indexOf('## Output files'));
    expect(prompt.indexOf('## Output files')).toBeLessThan(prompt.indexOf('## Events'));
  });

  it('is deterministic: the same script gives the same state.json byte for byte', async () => {
    const first = readStateText(runDirOf(project.root, 'linear'));
    const again = fixtureProject(['linear']);
    reportOf(await runFixture(testDeps(again.root, { script }), 'linear'));
    expect(readStateText(runDirOf(again.root, 'linear'))).toBe(first);
    again.remove();
  });

  it('refuses to run into a folder that already holds a run', async () => {
    const outcome = await runFixture(testDeps(project.root, { script }), 'linear');
    expect(outcome).toMatchObject({
      kind: 'refused',
      message: expect.stringContaining('already holds a run'),
    });
  });
});

describe('a diamond: fan-out, fan-in, a stranded branch', () => {
  it('runs left and right together and join once, after both', async () => {
    const deps = testDeps(project.root, {
      script: {
        split: [{ event: 'BOTH', writes: { '1-split/out.md': 's' } }],
        left: [done({ '2-left/out.md': 'l' }, { delayMs: 30 })],
        right: [done({ '2-right/out.md': 'r' })],
        join: [done({ '3-join/out.md': 'j' })],
      },
    });
    const outcome = reportOf(await runFixture(deps, 'diamond', { topic: 'both' }));
    const runDir = runDirOf(project.root, 'diamond', 'both');
    expect(outcome.kind).toBe('completed');
    const types = historyTypes(runDir);
    // left and right start before either returns; right (no delay) settles first; join runs once
    expect(types.slice(2, 6)).toEqual(['STEP_START', 'STEP_EVENT', 'STEP_START', 'STEP_START']);
    expect(outcome.report.passes).toEqual({ split: 1, left: 1, right: 1, join: 1 });
    expect(deps.harness.calls().map((call) => call.step)).toEqual([
      'split',
      'left',
      'right',
      'join',
    ]);
    expectValid(runDir);
    expectReplays(runDir);
  });

  it('skips the branch nothing routes to any more, with the reason', async () => {
    const deps = testDeps(project.root, {
      script: {
        split: [{ event: 'LEFT', writes: { '1-split/out.md': 's' } }],
        left: [done({ '2-left/out.md': 'l' })],
        join: [done({ '3-join/out.md': 'j' })],
      },
    });
    const outcome = reportOf(await runFixture(deps, 'diamond', { topic: 'left' }));
    const runDir = runDirOf(project.root, 'diamond', 'left');
    expect(outcome.kind).toBe('completed');
    expect(outcome.report.skipped).toEqual([
      { step: 'right', reason: 'split returned LEFT and nothing routes here any more' },
    ]);
    expect(deps.harness.calls().map((call) => call.step)).toEqual(['split', 'left', 'join']);
    expectValid(runDir);
    expectReplays(runDir);
  });
});

describe('a review loop with max and onMax', () => {
  it('loops twice, then the spent cap takes onMax; the revision pass carries the feedback', async () => {
    const deps = testDeps(project.root, {
      script: {
        draft: [
          done({ '1-draft/draft.md': 'v1' }),
          done({ '1-draft/draft.md': 'v2' }),
          done({ '1-draft/draft.md': 'v3' }),
        ],
        review: [
          { event: 'REVISE', writes: { '2-review/review.md': 'fix a' } },
          { event: 'REVISE', writes: { '2-review/review.md': 'fix b' } },
          { event: 'REVISE', writes: { '2-review/review.md': 'fix c' } },
        ],
        polish: [done({ '3-polish/final.md': 'final' })],
      },
    });
    const outcome = reportOf(await runFixture(deps, 'review-loop'));
    const runDir = runDirOf(project.root, 'review-loop');
    expect(outcome.kind).toBe('completed');
    expect(outcome.report.passes).toEqual({ draft: 3, review: 3, polish: 1 });
    expect(readState(runDir)['edges']).toEqual({
      'draft:DONE': 3,
      'review:REVISE': 2,
      'polish:DONE': 1,
    });
    expect(outcome.report.capped).toHaveLength(1);
    const secondDraft =
      deps.harness.calls().filter((call) => call.step === 'draft')[1]?.prompt ?? '';
    expect(secondDraft).toContain('## Revision pass 2');
    expect(secondDraft).toContain('2-review/review.md');
    expectValid(runDir);
    expectReplays(runDir);
  });

  it('a spent cap with no onMax stops the run', async () => {
    const deps = testDeps(project.root, {
      script: {
        draft: [done({ '1-draft/draft.md': 'v1' }), done({ '1-draft/draft.md': 'v2' })],
        review: [{ event: 'REVISE' }, { event: 'REVISE' }],
      },
    });
    const outcome = reportOf(await runFixture(deps, 'cap-no-onmax'));
    const runDir = runDirOf(project.root, 'cap-no-onmax');
    expect(outcome.kind).toBe('failed');
    expect(outcome.report.failure).toContain('cap-spent');
    expect(outcome.report.failure).toContain(
      'edge review:REVISE was taken 1 time(s), its max, and has no onMax',
    );
    expect(stepStatus(runDir, 'review')).toBe('COMPLETED');
    expectValid(runDir);
    expectReplays(runDir);
  });

  it('the fuse stops a step that would start too often', async () => {
    const deps = testDeps(project.root, {
      script: {
        draft: [done({ '1-draft/draft.md': 'v1' }), done({ '1-draft/draft.md': 'v2' })],
        review: [{ event: 'REVISE' }, { event: 'REVISE' }],
      },
    });
    const outcome = reportOf(
      await runFixture(deps, 'review-loop', { topic: 'fuse' }, { maxStepPasses: 1 }),
    );
    expect(outcome.kind).toBe('failed');
    expect(outcome.report.failure).toContain('the fuse stopped a loop');
    expectValid(runDirOf(project.root, 'review-loop', 'fuse'));
  });
});

describe('conditions on reported values', () => {
  it('takes the conditional edge when the reported value satisfies it', async () => {
    const deps = testDeps(project.root, {
      script: {
        count: [done({ '1-count/out.md': '3' }, { report: { findings: 3 } })],
        deep: [done({ '2-deep/out.md': 'd' })],
      },
    });
    const outcome = reportOf(await runFixture(deps, 'condition', { topic: 'many' }));
    const runDir = runDirOf(project.root, 'condition', 'many');
    expect(outcome.report.endedBy).toEqual(['deep:DONE']);
    expect(readState(runDir)['vars']).toEqual({ findings: 3 });
    expectValid(runDir);
    expectReplays(runDir);
  });

  it('falls back to the unconditional edge when it does not', async () => {
    const deps = testDeps(project.root, {
      script: { count: [done({ '1-count/out.md': '1' }, { report: { findings: 1 } })] },
    });
    const outcome = reportOf(await runFixture(deps, 'condition', { topic: 'few' }));
    const runDir = runDirOf(project.root, 'condition', 'few');
    expect(outcome.kind).toBe('completed');
    expect(outcome.report.skipped.map((skip) => skip.step)).toEqual(['deep']);
    expect(readState(runDir)['edges']).toEqual({ 'count:SKIP': 1 });
    expectValid(runDir);
  });

  it('refuses a condition that names something nobody reported or declared', async () => {
    const deps = testDeps(project.root, { script: { judge: [done({ '1-judge/out.md': 'j' })] } });
    const outcome = reportOf(await runFixture(deps, 'condition-unknown'));
    expect(outcome.kind).toBe('failed');
    expect(outcome.report.failure).toContain('bad-condition');
    expect(outcome.report.failure).toContain('"score"');
    expectValid(runDirOf(project.root, 'condition-unknown'));
  });
});

describe('an answer that names no event', () => {
  it('is asked once more in the same session, and the second answer counts', async () => {
    const deps = testDeps(project.root, {
      script: {
        a: [
          { text: 'FINISHED', sessionId: 's1', writes: { '1-a/out.md': 'a' } },
          { event: 'DONE', sessionId: 's1' },
        ],
        b: [done({})],
        c: [done({})],
      },
    });
    const outcome = reportOf(await runFixture(deps, 'linear', { topic: 'retry' }));
    expect(outcome.kind).toBe('completed');
    const calls = deps.harness.calls().filter((call) => call.step === 'a');
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ resumeSessionId: 's1' });
    expect(calls[1]?.prompt).toContain('Your answer named no event.');
    expectValid(runDirOf(project.root, 'linear', 'retry'));
  });

  it('a second miss fails the step and the run', async () => {
    const deps = testDeps(project.root, {
      script: {
        a: [
          { event: 'NOPE', sessionId: 's1' },
          { event: 'STILL_NOPE', sessionId: 's1' },
        ],
      },
    });
    const outcome = reportOf(await runFixture(deps, 'linear', { topic: 'miss' }));
    expect(outcome.kind).toBe('failed');
    expect(outcome.report.failed).toEqual([
      { step: 'a', error: 'returned "STILL_NOPE", which is not one of DONE' },
    ]);
    expectValid(runDirOf(project.root, 'linear', 'miss'));
  });

  it('a harness error fails the step; nothing new starts', async () => {
    const deps = testDeps(project.root, {
      script: { a: [{ fail: 'claude exited 1 with no result' }] },
    });
    const outcome = reportOf(await runFixture(deps, 'linear', { topic: 'broken' }));
    expect(outcome.kind).toBe('failed');
    expect(outcome.report.failed).toEqual([{ step: 'a', error: 'claude exited 1 with no result' }]);
    expect(stepStatus(runDirOf(project.root, 'linear', 'broken'), 'b')).toBe('PENDING');
  });
});

describe('time and interruption', () => {
  it('a step that runs past --step-timeout is killed and fails the run', async () => {
    const deps = testDeps(project.root, { script: { a: [{ hang: true }] } });
    const running = runFixture(deps, 'linear', { topic: 'slow' }, { stepTimeoutMs: 60_000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    deps.delays.increment(60_000);
    const outcome = reportOf(await running);
    expect(outcome.kind).toBe('failed');
    expect(outcome.report.failed).toEqual([{ step: 'a', error: 'timed out after 1 minute(s)' }]);
    expectValid(runDirOf(project.root, 'linear', 'slow'));
  });

  it('Ctrl-C mid fan-out parks the run as ABORTED, and resume completes it', async () => {
    const deps = testDeps(project.root, {
      script: {
        split: [{ event: 'BOTH', writes: { '1-split/out.md': 's' } }],
        left: [{ hang: true }, done({ '2-left/out.md': 'l' })],
        right: [done({ '2-right/out.md': 'r' }, { delayMs: 20 })],
        join: [done({ '3-join/out.md': 'j' })],
      },
    });
    const running = runFixture(deps, 'diamond', { topic: 'interrupted' });
    await new Promise((resolve) => setTimeout(resolve, 60));
    deps.abort();
    const stopped = reportOf(await running);
    const runDir = runDirOf(project.root, 'diamond', 'interrupted');
    expect(stopped.kind).toBe('stopped');
    expect(stopped.state.status).toBe('ABORTED');
    expect(stepStatus(runDir, 'right')).toBe('COMPLETED');
    expect(stepStatus(runDir, 'left')).toBe('FAILED');
    expectValid(runDir);

    const resumed = reportOf(
      await resumeRunFactory(
        testDeps(project.root, {
          script: {
            left: [done({ '2-left/out.md': 'l' })],
            join: [done({ '3-join/out.md': 'j' })],
          },
        }),
      )({ runDir }),
    );
    expect(resumed.kind).toBe('completed');
    expect(resumed.report.passes).toEqual({ split: 1, left: 2, right: 1, join: 1 });
    expect(readState(runDir)['edges']).toEqual({
      'split:BOTH': 1,
      'left:DONE': 1,
      'right:DONE': 1,
      'join:DONE': 1,
    });
    expect(historyTypes(runDir)).toContain('PIPELINE_RESUME');
    expectValid(runDir);
  });

  it('a run that stopped in the middle of its steps (a crash) resumes: finished steps stand, the rest runs again', async () => {
    // Simulate a crash: run until `b` is running, then throw the process away (never await the outcome).
    const first = testDeps(project.root, {
      script: { a: [done({ '1-a/out.md': 'a' })], b: [{ hang: true }] },
    });
    void runFixture(first, 'linear', { topic: 'crash' });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const runDir = runDirOf(project.root, 'linear', 'crash');
    expect(readState(runDir)['status']).toBe('RUNNING');
    expect(stepStatus(runDir, 'b')).toBe('RUNNING');

    const resumed = reportOf(
      await resumeRunFactory(
        testDeps(project.root, {
          script: { b: [done({ '2-b/out.md': 'b' })], c: [done({ '3-c/out.md': 'c' })] },
        }),
      )({ runDir }),
    );
    expect(resumed.kind).toBe('completed');
    expect(resumed.report.passes).toEqual({ a: 1, b: 2, c: 1 });
    expect(readState(runDir)['edges']).toEqual({ 'a:DONE': 1, 'b:DONE': 1, 'c:DONE': 1 });
    expectValid(runDir);
    first.abort();
  });

  it('refuses a snapshot written by another machine version', async () => {
    const runDir = runDirOf(project.root, 'linear', 'crash');
    const file = path.join(runDir, 'snapshot.json');
    const snapshot = JSON.parse(readFileSync(file, 'utf8')) as { machineVersion: number };
    writeFileSync(
      file,
      JSON.stringify({ ...snapshot, machineVersion: snapshot.machineVersion + 1 }),
    );
    expect(await resumeRunFactory(testDeps(project.root))({ runDir })).toMatchObject({
      kind: 'refused',
      guard: 'snapshot-version-matches',
    });
  });
});

describe('a human step', () => {
  it("in terminal mode asks with the step's events, writes the decision and briefs the next pass", async () => {
    const human = scriptedHuman([
      { kind: 'answered', event: 'REJECT', note: 'shorter' },
      { kind: 'answered', event: 'APPROVE', note: '' },
    ]);
    const deps = testDeps(project.root, {
      script: { draft: [done({ '1-draft/draft.md': 'v1' }), done({ '1-draft/draft.md': 'v2' })] },
      human,
    });
    const outcome = reportOf(await runFixture(deps, 'human-gate', {}, { humanMode: 'terminal' }));
    const runDir = runDirOf(project.root, 'human-gate');
    expect(outcome.kind).toBe('completed');
    expect(human.asked[0]).toMatchObject({
      stepName: 'approve',
      allowedEvents: ['APPROVE', 'REJECT'],
    });
    expect(readFileSync(path.join(runDir, '2-approve', 'decision.md'), 'utf8')).toContain(
      '- **Answer:** APPROVE',
    );
    expect(deps.harness.calls()[1]?.prompt).toContain('Note from "approve": shorter');
    expect(historyTypes(runDir).filter((type) => type === 'HUMAN_ANSWER')).toHaveLength(2);
    expect(readState(runDir)['edges']).toEqual({
      'draft:DONE': 2,
      'approve:REJECT': 1,
      'approve:APPROVE': 1,
    });
    expectValid(runDir);
    expectReplays(runDir);
  });

  it('in park mode parks the run; `answer` resumes it, twice, across process exits', async () => {
    const script: Script = {
      draft: [done({ '1-draft/draft.md': 'v1' }), done({ '1-draft/draft.md': 'v2' })],
    };
    const parked = reportOf(
      await runFixture(testDeps(project.root, { script }), 'human-gate', { topic: 'parked' }),
    );
    const runDir = runDirOf(project.root, 'human-gate', 'parked');
    expect(parked.kind).toBe('parked');
    expect(parked.state.status).toBe('PAUSED');
    expect(parked.report.awaiting).toMatchObject({
      step: 'approve',
      events: ['APPROVE', 'REJECT'],
    });
    expectValid(runDir);

    // a new process: the second draft pass takes the next scripted answer
    const again = reportOf(
      await answerHumanFactory(
        testDeps(project.root, { script: { draft: [done({ '1-draft/draft.md': 'v2' })] } }),
      )({
        runDir,
        step: 'approve',
        event: 'REJECT',
        note: 'recount',
      }),
    );
    expect(again.kind).toBe('parked');
    expect(readState(runDir)['edges']).toEqual({ 'draft:DONE': 2, 'approve:REJECT': 1 });
    expect(readFileSync(path.join(runDir, '2-approve', 'decision.md'), 'utf8')).toContain(
      'recount',
    );

    const finished = reportOf(
      await answerHumanFactory(testDeps(project.root))({
        runDir,
        step: 'approve',
        event: 'APPROVE',
        note: '',
      }),
    );
    expect(finished.kind).toBe('completed');
    expect(finished.report.passes).toEqual({ draft: 2, approve: 2 });
    expectValid(runDir);
    expectReplays(runDir);
  });

  it('refuses an answer for the wrong step or with an unknown event', async () => {
    const runDir = runDirOf(project.root, 'human-gate', 'parked');
    expect(
      await answerHumanFactory(testDeps(project.root))({
        runDir,
        step: 'approve',
        event: 'MAYBE',
        note: '',
      }),
    ).toMatchObject({
      kind: 'refused',
    });
  });
});

describe('hooks', () => {
  it('a failing hooks.before stops the run before any agent starts; hooks.after still runs', async () => {
    const deps = testDeps(project.root, { script: { only: [done({ '1-only/out.md': 'o' })] } });
    const outcome = reportOf(
      await runFixture(deps, 'hooks', { topic: 'bad-before', before: 'exit 3' }),
    );
    const runDir = runDirOf(project.root, 'hooks', 'bad-before');
    expect(outcome.kind).toBe('failed');
    expect(outcome.report.failure).toContain('hooks.before failed');
    expect(deps.harness.calls()).toHaveLength(0);
    expect(outcome.report.hooks.map((hook) => [hook.phase, hook.exitCode])).toEqual([
      ['before', 3],
      ['after', 0],
    ]);
    expect(existsSync(path.join(runDir, 'hook-after.txt'))).toBe(true);
    expectValid(runDir);
  });

  it('a failing hooks.after is reported, not fatal', async () => {
    const deps = testDeps(project.root, { script: { only: [done({ '1-only/out.md': 'o' })] } });
    const outcome = reportOf(
      await runFixture(deps, 'hooks', { topic: 'bad-after', after: 'exit 4' }),
    );
    const runDir = runDirOf(project.root, 'hooks', 'bad-after');
    expect(outcome.kind).toBe('completed');
    expect(outcome.report.hooks.map((hook) => [hook.phase, hook.exitCode])).toEqual([
      ['before', 0],
      ['after', 4],
    ]);
    expect(existsSync(path.join(runDir, 'hook-before.txt'))).toBe(true);
    expectValid(runDir);
  });
});

describe('refusals before a run opens', () => {
  it('an invalid pipeline never opens a run folder', async () => {
    const bad = fixtureProject([]);
    const dir = path.join(bad.root, 'factories.local', 'broken');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'pipeline.json'),
      JSON.stringify({
        id: 'broken',
        constants: { rootPath: 'cwd', skillPath: '.', homePath: '~' },
        outputDir: '{{rootPath}}/run/{{id}}/x',
        START: ['a'],
        steps: { a: { agent: 'x', prompt: ['p'], transitions: { DONE: { target: ['nowhere'] } } } },
      }),
    );
    const outcome = await runFixture(testDeps(bad.root), 'broken');
    expect(outcome).toMatchObject({
      kind: 'refused',
      message: expect.stringContaining('[targets-exist]'),
    });
    expect(existsSync(path.join(bad.root, 'run'))).toBe(false);
    bad.remove();
  });

  it('a missing required param is refused by name', async () => {
    const outcome = await runFixture(testDeps(project.root), 'linear', { nope: '1' });
    expect(outcome).toMatchObject({
      kind: 'refused',
      message: expect.stringContaining('param-known'),
    });
  });

  it('an unknown harness is refused', async () => {
    const outcome = await runFixture(testDeps(project.root), 'linear', {}, { harness: 'codex' });
    expect(outcome).toMatchObject({ kind: 'refused', guard: 'harness-installed' });
  });
});
