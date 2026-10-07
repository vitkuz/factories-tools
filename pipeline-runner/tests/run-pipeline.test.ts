import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  resumePipelineFactory,
  runPipelineFactory,
  stateFileOf,
} from '../src/features/run/index.js';
import type { RunReport, RunState } from '../src/features/run/index.js';
import { isAppError } from '../src/shared/utils/error.utils.js';
import { demoDefinition } from './helpers.js';
import { bench, scriptedHuman, scriptedShell, type Bench } from './run-helpers.js';

const OPTIONS = { maxStepPasses: 12 };

const stateOf = (b: Bench): RunState =>
  JSON.parse(b.fileSystem.files.get(stateFileOf(b.pipeline.outputDir)) ?? '{}') as RunState;

const withSteps = (
  change: (steps: Record<string, Record<string, unknown>>) => void,
): Record<string, unknown> => {
  const definition = demoDefinition();
  change(definition['steps'] as Record<string, Record<string, unknown>>);
  return definition;
};

describe('runPipeline', () => {
  it('runs START in parallel, fans in once, and finishes at END', async () => {
    const b = bench({
      plan: [{ event: 'DONE', afterMs: 5 }],
      design: [{ event: 'DONE', afterMs: 40 }],
      build: ['DONE'],
      review: ['APPROVE'],
    });
    const report: RunReport = await runPipelineFactory(b.deps)(b.pipeline, OPTIONS);

    expect(report.status).toBe('COMPLETED');
    expect(report.endedBy).toEqual(['review:APPROVE']);
    expect(report.passes).toEqual({ plan: 1, design: 1, build: 1, review: 1 });
    // both START steps began before either ended; build began only after the SLOW sibling ended
    expect([...b.agent.timeline.slice(0, 2)].sort()).toEqual(['start:design', 'start:plan']);
    expect(b.agent.timeline.indexOf('start:build')).toBeGreaterThan(
      b.agent.timeline.indexOf('end:design'),
    );
    expect(b.agent.calls.filter((call) => call.stepName === 'build')).toHaveLength(1);
    expect(b.shell.commands).toEqual([
      `echo before ${b.pipeline.outputDir}`,
      `echo after ${b.pipeline.outputDir}`,
    ]);
  });

  it('counts a capped edge and takes onMax on the traversal that overspends it', async () => {
    const b = bench({
      plan: ['DONE'],
      design: ['DONE'],
      build: ['DONE', 'DONE', 'DONE'],
      review: ['REVISE', 'REVISE', 'REVISE'],
    });
    const report: RunReport = await runPipelineFactory(b.deps)(b.pipeline, OPTIONS);

    expect(report.status).toBe('COMPLETED');
    expect(report.passes).toMatchObject({ build: 3, review: 3 });
    expect(report.endedBy).toEqual(['review:REVISE']);
    expect(report.capped).toHaveLength(1);
    expect(stateOf(b).edges).toMatchObject({ 'review:REVISE': 3, 'build:DONE': 3 });
  });

  it('tells a revision pass who sent it back and where the feedback is', async () => {
    const b = bench({
      plan: ['DONE'],
      design: ['DONE'],
      build: ['DONE', 'DONE'],
      review: ['REVISE', 'APPROVE'],
    });
    b.fileSystem.files.set(`${b.pipeline.outputDir}/4-review/feedback.md`, 'fix the nav');
    await runPipelineFactory(b.deps)(b.pipeline, OPTIONS);
    const [first, second] = b.agent.calls.filter((call) => call.stepName === 'build');

    expect(first?.prompt).not.toContain('Revision pass');
    expect(second?.prompt).toContain('## Revision pass 2');
    expect(second?.prompt).toContain('Step "review" returned REVISE');
    expect(second?.prompt).toContain(`${b.pipeline.outputDir}/4-review/feedback.md`);
  });

  it('builds the task message in the fixed order, with knowledge pasted and absent inputs marked', async () => {
    const b = bench({ plan: ['DONE'], design: ['DONE'], build: ['DONE'], review: ['APPROVE'] });
    await runPipelineFactory(b.deps)(b.pipeline, OPTIONS);
    const plan = b.agent.calls.find((call) => call.stepName === 'plan');
    const build = b.agent.calls.find((call) => call.stepName === 'build');
    const order: number[] = [
      'Plan How to',
      '## Knowledge',
      'Shape the outline like this.',
      '## Output files',
      '## Events',
    ].map((needle: string): number => plan?.prompt.indexOf(needle) ?? -1);

    expect(
      order.every(
        (at: number, i: number): boolean => at >= 0 && (i === 0 || at > (order[i - 1] ?? 0)),
      ),
    ).toBe(true);
    expect(plan?.model).toBe('opus');
    expect(build?.model).toBeUndefined();
    expect(build?.systemPrompt).toBe('You build demo-factory.');
    expect(build?.cwd).toBe('/repo');
    expect(build?.prompt).toContain('4-review/feedback.md — not present on this pass');
    expect(build?.prompt).not.toMatch(/state\.json|recorder/);
  });

  it('runs a step without a missing knowledge file or agent profile, and records that it did', async () => {
    const custom = withSteps((steps) => {
      steps['plan'] = { ...steps['plan'], agent: 'outline-architect' };
    });
    const b = bench(
      { plan: ['DONE'], design: ['DONE'], build: ['DONE'], review: ['APPROVE'] },
      custom,
    );
    b.fileSystem.files.delete('/repo/knowledge/outline.md');
    const report: RunReport = await runPipelineFactory(b.deps)(b.pipeline, OPTIONS);
    const plan = b.agent.calls.find((call) => call.stepName === 'plan');

    expect(report.status).toBe('COMPLETED');
    expect(plan?.agentProfile).toBeUndefined();
    expect(plan?.prompt).not.toContain('<knowledge');
    expect(plan?.prompt).toContain('## Knowledge not available');
    expect(plan?.prompt).toContain('- outline.md');
    expect(stateOf(b).steps['plan']?.note).toBe(
      'agent "outline-architect" has no profile; general-purpose stood in; ran without knowledge: /repo/knowledge/outline.md',
    );
    expect(stateOf(b).steps['design']?.note).toBeUndefined();
  });

  it('asks once more when the answer names no known event, then fails the step on a second miss', async () => {
    const ok = bench({
      plan: ['FINISHED', 'DONE'],
      design: ['DONE'],
      build: ['DONE'],
      review: ['APPROVE'],
    });
    expect((await runPipelineFactory(ok.deps)(ok.pipeline, OPTIONS)).status).toBe('COMPLETED');
    expect(
      ok.agent.calls[2]?.resumeSessionId ??
        ok.agent.calls.find((c) => c.resumeSessionId)?.resumeSessionId,
    ).toBe('session-plan-1');

    const bad = bench({ plan: ['FINISHED', 'NOPE'], design: ['DONE'] });
    const report: RunReport = await runPipelineFactory(bad.deps)(bad.pipeline, OPTIONS);
    expect(report.status).toBe('FAILED');
    expect(report.failed[0]?.step).toBe('plan');
    expect(bad.agent.calls.some((call) => call.stepName === 'build')).toBe(false);
  });

  it('routes on a condition over reported values, and stops where the graph refuses', async () => {
    const gated = withSteps((steps) => {
      steps['review'] = {
        ...steps['review'],
        transitions: {
          APPROVE: { target: ['END'], condition: 'findings < 2 and depth == 2' },
          REVISE: { target: ['build'], max: 2, onMax: ['END'] },
        },
      };
    });
    const pass = bench(
      {
        plan: ['DONE'],
        design: ['DONE'],
        build: ['DONE'],
        review: [{ event: 'APPROVE', reported: { findings: 1 } }],
      },
      gated,
    );
    expect((await runPipelineFactory(pass.deps)(pass.pipeline, OPTIONS)).status).toBe('COMPLETED');
    expect(stateOf(pass).vars).toEqual({ findings: 1 });

    const stop = bench(
      {
        plan: ['DONE'],
        design: ['DONE'],
        build: ['DONE'],
        review: [{ event: 'APPROVE', reported: { findings: 7 } }],
      },
      gated,
    );
    const report: RunReport = await runPipelineFactory(stop.deps)(stop.pipeline, OPTIONS);
    expect(report.status).toBe('FAILED');
    expect(report.failure).toContain('is false');
  });

  it('skips the branch a gate closed, with the reason', async () => {
    const gate = withSteps((steps) => {
      steps['review'] = {
        ...steps['review'],
        transitions: { APPROVE: { target: ['publish'] }, REJECT: { target: ['END'] } },
      };
      steps['publish'] = {
        agent: 'general-purpose',
        prompt: ['Publish.'],
        transitions: { DONE: { target: ['END'] } },
      };
    });
    const b = bench(
      { plan: ['DONE'], design: ['DONE'], build: ['DONE'], review: ['REJECT'] },
      gate,
    );
    const report: RunReport = await runPipelineFactory(b.deps)(b.pipeline, OPTIONS);

    expect(report.status).toBe('COMPLETED');
    expect(report.skipped).toEqual([
      { step: 'publish', reason: 'review returned REJECT and nothing routes here any more' },
    ]);
  });

  it('spawns nothing when a before hook fails, and still runs the after hooks', async () => {
    const b = bench({}, undefined, { shell: scriptedShell({ 'echo before': 3 }) });
    const report: RunReport = await runPipelineFactory(b.deps)(b.pipeline, OPTIONS);

    expect(report.status).toBe('FAILED');
    expect(b.agent.calls).toHaveLength(0);
    expect(b.shell.commands).toHaveLength(2);
  });

  it('lets a running sibling finish after a failure, then resumes from exactly there', async () => {
    const b = bench({
      plan: [{ throws: 'overloaded', afterMs: 5 }, 'DONE'],
      design: [{ event: 'DONE', afterMs: 30 }],
      build: ['DONE'],
      review: ['APPROVE'],
    });
    const failed: RunReport = await runPipelineFactory(b.deps)(b.pipeline, OPTIONS);
    expect(failed.status).toBe('FAILED');
    expect(stateOf(b).steps['design']?.status).toBe('COMPLETED');
    expect(stateOf(b).steps['plan']?.status).toBe('FAILED');

    const resumed: RunReport = await resumePipelineFactory(b.deps)(b.pipeline, OPTIONS);
    expect(resumed.status).toBe('COMPLETED');
    expect(resumed.passes).toEqual({ plan: 2, design: 1, build: 1, review: 1 });
    expect(
      b.shell.commands.filter((command: string): boolean => command.includes('before')),
    ).toHaveLength(1);
  });

  it('refuses to reuse a run folder', async () => {
    const b = bench({ plan: ['DONE'], design: ['DONE'], build: ['DONE'], review: ['APPROVE'] });
    await runPipelineFactory(b.deps)(b.pipeline, OPTIONS);
    await expect(runPipelineFactory(b.deps)(b.pipeline, OPTIONS)).rejects.toSatisfy(isAppError);
  });

  it('blows the fuse on a loop no max bounds instead of spinning', async () => {
    const loop = withSteps((steps) => {
      steps['review'] = {
        ...steps['review'],
        transitions: { APPROVE: { target: ['END'] }, REVISE: { target: ['build'] } },
      };
    });
    const b = bench(
      {
        plan: ['DONE'],
        design: ['DONE'],
        build: Array(9).fill('DONE'),
        review: Array(9).fill('REVISE'),
      },
      loop,
    );
    const report: RunReport = await runPipelineFactory(b.deps)(b.pipeline, { maxStepPasses: 3 });

    expect(report.status).toBe('FAILED');
    expect(report.failure).toContain('fuse');
    expect(report.passes['build']).toBe(3);
  });

  it('asks a person at a human step and writes the decision file itself', async () => {
    const human = withSteps((steps) => {
      steps['review'] = {
        agent: 'human',
        prompt: ['APPROVE or REVISE?'],
        input: ['3-build/*.md'],
        output: ['4-review/decision.md'],
        transitions: {
          APPROVE: { target: ['END'] },
          REVISE: { target: ['build'], max: 1, onMax: ['END'] },
        },
      };
    });
    const b = bench({ plan: ['DONE'], design: ['DONE'], build: ['DONE', 'DONE'] }, human, {
      human: scriptedHuman([
        { event: 'REVISE', note: 'make the header smaller' },
        { event: 'APPROVE', note: '' },
      ]),
    });
    const report: RunReport = await runPipelineFactory(b.deps)(b.pipeline, OPTIONS);

    expect(report.status).toBe('COMPLETED');
    expect(b.fileSystem.files.get(`${b.pipeline.outputDir}/4-review/decision.md`)).toContain(
      'APPROVE',
    );
    expect(stateOf(b).history.filter((event) => event.type === 'HUMAN_ANSWER')).toHaveLength(2);
    expect(b.agent.calls.filter((call) => call.stepName === 'build')[1]?.prompt).toContain(
      '4-review/decision.md',
    );
  });

  it('is deterministic: the same script yields the same state, byte for byte', async () => {
    const script = {
      plan: ['DONE'],
      design: ['DONE'],
      build: ['DONE', 'DONE'],
      review: ['REVISE', 'APPROVE'],
    };
    const [a, b] = [bench(script), bench(script)];
    await runPipelineFactory(a.deps)(a.pipeline, OPTIONS);
    await runPipelineFactory(b.deps)(b.pipeline, OPTIONS);
    expect(a.fileSystem.files.get(stateFileOf(a.pipeline.outputDir))).toBe(
      b.fileSystem.files.get(stateFileOf(b.pipeline.outputDir)),
    );
  });

  it('writes a state file the real state.schema.json accepts', async () => {
    const factories = path.resolve(__dirname, '../../../factories');
    const { validateAgainstSchema, loadJson } = (await import(
      pathToFileURL(path.join(__dirname, 'support/json-schema.mjs')).href
    )) as {
      validateAgainstSchema: (value: unknown, schema: unknown) => string[];
      loadJson: (file: string) => unknown;
    };
    const b = bench({
      plan: ['DONE'],
      design: ['DONE'],
      build: ['DONE', 'DONE', 'DONE'],
      review: ['REVISE', 'REVISE', 'REVISE'],
    });
    await runPipelineFactory(b.deps)(b.pipeline, OPTIONS);

    expect(
      validateAgainstSchema(stateOf(b), loadJson(path.join(factories, 'state.schema.json'))),
    ).toEqual([]);
  });
});
