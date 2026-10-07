import { describe, expect, it } from 'vitest';
import { formatCost, formatReport } from '../src/cli/cli.utils.js';
import { createAgentAdapter, type AgentAdapterSettings } from '../src/cli/create-agent-adapter.js';
import {
  agentProfileCandidatesFor,
  harnessSchema,
  tierMapSchema,
  unmappedTiers,
  type Harness,
} from '../src/features/harness/index.js';
import { verifyWorkspaceFactory } from '../src/features/pipeline/services/index.js';
import { resolvePipeline } from '../src/features/pipeline/services/index.js';
import type { ResolvedPipeline } from '../src/features/pipeline/index.js';
import { runPipelineFactory, runStateSchema, stateFileOf } from '../src/features/run/index.js';
import type { RunReport, RunState } from '../src/features/run/index.js';
import { resolveAgentProfileFactory } from '../src/features/run/services/index.js';
import { isAppError } from '../src/shared/utils/error.utils.js';
import type { ProcessRequest } from '../src/shared/utils/process.utils.js';
import { REQUEST, fakeProcess, jsonLines, scratch } from './adapter-helpers.js';
import { ROOT, context, demoDefinition, load, memoryFileSystem } from './helpers.js';
import { bench } from './run-helpers.js';

const ANCHORS = { rootPath: ROOT, skillPath: `${ROOT}/.claude/skills/demo`, homePath: '/home/me' };

/** One stdout per harness that says APPROVE in that harness's own output shape. */
const APPROVE: Record<Harness, string> = {
  claude: JSON.stringify({ type: 'result', result: '', structured_output: { event: 'APPROVE' } }),
  codex: jsonLines({
    type: 'item.completed',
    item: { type: 'agent_message', text: '{"event":"APPROVE"}' },
  }),
  copilot: jsonLines(
    { type: 'assistant.message', data: { content: 'APPROVE' } },
    { type: 'result', sessionId: 's', exitCode: 0 },
  ),
  agy: JSON.stringify({ status: 'SUCCESS', structured_output: { event: 'APPROVE' } }),
};

const settingsWith = (
  harness: Harness,
  seen: ProcessRequest[],
  extra: Partial<AgentAdapterSettings> = {},
): AgentAdapterSettings => ({
  bins: { claude: 'claude-x', codex: 'codex-x', copilot: 'copilot-x', agy: 'agy-x' },
  models: { claude: {}, codex: { opus: 'gpt-6-astra' }, copilot: {}, agy: {} },
  permissionMode: 'bypassPermissions',
  timeoutMs: 60_000,
  homePath: '/home/me',
  tempDir: '/tmp',
  fileSystem: scratch(),
  runProcess: fakeProcess({ stdout: APPROVE[harness] }, seen),
  ...extra,
});

describe('createAgentAdapter', () => {
  it('builds the adapter the harness names, with that harness’s binary and tier map', async () => {
    const started: Record<string, ProcessRequest> = {};
    for (const harness of harnessSchema.options) {
      const seen: ProcessRequest[] = [];
      const answer = await createAgentAdapter(harness, settingsWith(harness, seen)).runAgent(
        REQUEST,
      );
      expect(answer.event).toBe('APPROVE');
      started[harness] = seen[0] as ProcessRequest;
    }

    expect(Object.values(started).map((call: ProcessRequest): string => call.bin)).toEqual([
      'claude-x',
      'codex-x',
      'copilot-x',
      'agy-x',
    ]);
    expect(started['claude']?.args.join(' ')).toContain('--model opus'); // the tier is the alias
    expect(started['codex']?.args.join(' ')).toContain('-m gpt-6-astra');
    expect(started['copilot']?.args).not.toContain('--model'); // unmapped: the harness default
    expect(started['agy']?.args).not.toContain('--model');
  });

  it('applies the role fallback only where there is no system-prompt flag', async () => {
    const inputs: Record<string, string> = {};
    for (const harness of harnessSchema.options) {
      const seen: ProcessRequest[] = [];
      await createAgentAdapter(harness, settingsWith(harness, seen)).runAgent(REQUEST);
      inputs[harness] = seen[0]?.input ?? seen[0]?.args[0] ?? '';
    }

    expect(inputs['claude']).toBe('Review it.');
    expect(inputs['codex']?.startsWith('## Role\nYou are strict.')).toBe(true);
    expect(inputs['copilot']?.startsWith('## Role\nYou are strict.')).toBe(true);
    expect(inputs['agy']?.startsWith('--print=## Role\nYou are strict.')).toBe(true);
    // the report-block convention reaches only the harness with no structured output
    expect(
      Object.keys(inputs).filter((harness: string): boolean =>
        (inputs[harness] ?? '').includes('```json'),
      ),
    ).toEqual(['copilot']);
  });

  it('gives a step with no model the default model, on every harness', async () => {
    const { model: _model, ...noModel } = REQUEST;
    for (const harness of harnessSchema.options) {
      const seen: ProcessRequest[] = [];
      await createAgentAdapter(
        harness,
        settingsWith(harness, seen, { defaultModel: 'cheap-one' }),
      ).runAgent(noModel);
      expect(seen[0]?.args).toContain('cheap-one');
    }
  });

  it('refuses, before anything starts, a permission mode the harness cannot honour', () => {
    const refusal = (harness: Harness): unknown => {
      try {
        createAgentAdapter(harness, settingsWith(harness, [], { permissionMode: 'dontAsk' }));
        return undefined;
      } catch (error) {
        return error;
      }
    };

    expect(refusal('claude')).toBeUndefined();
    (['codex', 'copilot', 'agy'] as Harness[]).forEach((harness: Harness): void => {
      const error: unknown = refusal(harness);
      expect(isAppError(error) && error.code).toBe('PERMISSION_MODE_UNSUPPORTED');
      expect(isAppError(error) && error.issues[0]).toContain(`${harness} supports:`);
    });
  });
});

describe('tier map', () => {
  it('parses tier=model pairs, and is empty by default', () => {
    expect(tierMapSchema.parse('opus=gpt-6-astra, haiku=gpt-5.6-luna')).toEqual({
      opus: 'gpt-6-astra',
      haiku: 'gpt-5.6-luna',
    });
    expect(tierMapSchema.parse(undefined)).toEqual({});
    expect(tierMapSchema.parse('')).toEqual({});
  });

  it('rejects a tier that does not exist and an entry that is not a pair', () => {
    expect(tierMapSchema.safeParse('ultra=gpt-9').success).toBe(false);
    expect(tierMapSchema.safeParse('gpt-6-astra').success).toBe(false);
    expect(tierMapSchema.safeParse('opus=').success).toBe(false);
  });

  it('lists each tier a pipeline names that the harness has no model for, once', () => {
    expect(unmappedTiers(['opus', undefined, 'haiku', 'opus', 'sonnet'], { haiku: 'x' })).toEqual([
      'opus',
      'sonnet',
    ]);
    expect(unmappedTiers([undefined], {})).toEqual([]);
  });
});

describe('custom agents per harness', () => {
  const withAgent = (): ResolvedPipeline => {
    const definition = demoDefinition();
    const steps = definition['steps'] as Record<string, Record<string, unknown>>;
    steps['review'] = { ...steps['review'], agent: 'strict-reviewer' };
    return resolvePipeline(context())(load(definition));
  };
  const files = (extra: Record<string, string>): Record<string, string> => ({
    [`${ROOT}/.claude/settings.json`]: '{}',
    [`${ROOT}/knowledge/outline.md`]: 'Shape the outline.',
    ...extra,
  });

  it('looks where each harness keeps its agents — and nowhere for codex', () => {
    expect(agentProfileCandidatesFor('claude')(ANCHORS, 'a')).toEqual([
      `${ROOT}/.claude/agents/a.md`,
      '/home/me/.claude/agents/a.md',
    ]);
    expect(agentProfileCandidatesFor('copilot')(ANCHORS, 'a')).toContain(
      `${ROOT}/.github/agents/a.agent.md`,
    );
    expect(agentProfileCandidatesFor('agy')(ANCHORS, 'a')).toContain(
      `${ROOT}/.agents/agents/a/agent.md`,
    );
    expect(agentProfileCandidatesFor('codex')(ANCHORS, 'a')).toEqual([]);
  });

  it('warns at load when the profile exists for another harness only', async () => {
    const claudeOnly = memoryFileSystem(
      files({ [`${ROOT}/.claude/agents/strict-reviewer.md`]: '# strict' }),
    );

    expect((await verifyWorkspaceFactory(claudeOnly, 'claude')(withAgent())).warnings).toEqual([]);
    expect((await verifyWorkspaceFactory(claudeOnly, 'copilot')(withAgent())).warnings).toEqual([
      'agent "strict-reviewer" has no profile under .github/agents — general-purpose will stand in for review',
    ]);
    expect((await verifyWorkspaceFactory(claudeOnly, 'codex')(withAgent())).warnings[0]).toContain(
      'codex has no custom agents — general-purpose will stand in for review',
    );
  });

  it('hands the step the profile only when this harness has it', async () => {
    const fileSystem = memoryFileSystem(
      files({ [`${ROOT}/.github/agents/strict-reviewer.agent.md`]: '# strict' }),
    );

    expect(
      await resolveAgentProfileFactory(fileSystem, ANCHORS, 'copilot')('strict-reviewer'),
    ).toEqual({ profile: 'strict-reviewer' });
    expect(
      (await resolveAgentProfileFactory(fileSystem, ANCHORS, 'claude')('strict-reviewer')).note,
    ).toContain('general-purpose stood in');
    expect(
      await resolveAgentProfileFactory(fileSystem, ANCHORS, 'codex')('general-purpose'),
    ).toEqual({});
  });
});

describe('harness and usage in the record', () => {
  const script = {
    plan: [{ event: 'DONE', costUsd: undefined, usage: { inputTokens: 100, outputTokens: 5 } }],
    design: [{ event: 'DONE', costUsd: undefined, usage: { inputTokens: 50, outputTokens: 1 } }],
    build: [{ event: 'DONE', costUsd: undefined, usage: { premiumRequests: 0.33 } }],
    review: [
      { event: 'MAYBE', costUsd: undefined, usage: { inputTokens: 10, outputTokens: 1 } },
      { event: 'APPROVE', costUsd: undefined, usage: { inputTokens: 10, outputTokens: 1 } },
    ],
  };

  it('records the harness under context.captured and sums what the steps reported', async () => {
    const b = bench(script);
    const report: RunReport = await runPipelineFactory({ ...b.deps, harness: 'codex' })(
      b.pipeline,
      { maxStepPasses: 12 },
    );
    const state: RunState = runStateSchema.parse(
      JSON.parse(b.fileSystem.files.get(stateFileOf(b.pipeline.outputDir)) ?? '{}'),
    );

    expect(state.context.captured.harness).toBe('codex');
    expect(state.context.captured.costUsd).toBe(0);
    // the retried step counts both of its calls
    expect(state.context.captured.usage).toEqual({
      inputTokens: 170,
      outputTokens: 8,
      premiumRequests: 0.33,
    });
    expect(report).toMatchObject({ status: 'COMPLETED', harness: 'codex', costUsd: 0 });
    expect(formatReport(report)).toContain('harness      codex');
    expect(formatReport(report)).toContain(
      'cost         170 tokens in, 8 out · 0.33 premium requests',
    );
    expect(formatReport(report)).not.toContain('$0.00');
  });

  it('takes a retry’s session-wide figure instead of adding it to the first call’s', async () => {
    const b = bench({
      ...script,
      review: [
        { event: 'MAYBE', costUsd: undefined, usage: { premiumRequests: 0.33 } },
        {
          event: 'APPROVE',
          costUsd: undefined,
          usage: { premiumRequests: 0.66 },
          usageCoversSession: true,
        },
      ],
    });
    await runPipelineFactory(b.deps)(b.pipeline, { maxStepPasses: 12 });
    const state: RunState = runStateSchema.parse(
      JSON.parse(b.fileSystem.files.get(stateFileOf(b.pipeline.outputDir)) ?? '{}'),
    );

    // build's 0.33, then review's 0.66 alone — not 0.33 + 0.66 for review on top of it
    expect(state.context.captured.usage.premiumRequests).toBeCloseTo(0.99);
  });

  it('records the session of every pass in the history, not only the last', async () => {
    // review sends the work back once, so build runs twice — in two different agent sessions
    const b = bench({
      plan: ['DONE'],
      design: ['DONE'],
      build: ['DONE', 'DONE'],
      review: ['REVISE', 'APPROVE'],
    });
    await runPipelineFactory(b.deps)(b.pipeline, { maxStepPasses: 12 });
    const state: RunState = runStateSchema.parse(
      JSON.parse(b.fileSystem.files.get(stateFileOf(b.pipeline.outputDir)) ?? '{}'),
    );
    const sessionsOf = (step: string): unknown[] =>
      state.history
        .filter((event): boolean => event.type === 'STEP_EVENT' && event.step === step)
        .map((event): unknown => event.details?.['sessionId']);

    // the step record keeps only the last pass; the history keeps the session of each one
    expect(sessionsOf('build')).toEqual(['session-build-1', 'session-build-2']);
    expect(state.steps['build']?.sessionId).toBe('session-build-2');
    expect(sessionsOf('plan')).toEqual(['session-plan-1']);
  });

  it('leaves the harness out of the record when nobody named one', async () => {
    const b = bench({ plan: ['DONE'], design: ['DONE'], build: ['DONE'], review: ['APPROVE'] });
    const report: RunReport = await runPipelineFactory(b.deps)(b.pipeline, { maxStepPasses: 12 });

    expect(report.harness).toBeUndefined();
    expect(formatReport(report)).toContain('cost         $0.04');
  });

  it('never prints $0.00: dollars, tokens, premium requests, or "not reported"', () => {
    expect(formatCost(1.554, {})).toBe('$1.55');
    expect(formatCost(0, { inputTokens: 15505, cachedInputTokens: 100, outputTokens: 30 })).toBe(
      '15,505 tokens in (100 cached), 30 out',
    );
    expect(formatCost(0, { premiumRequests: 1 })).toBe('1 premium requests');
    expect(formatCost(0, {})).toBe('not reported');
  });
});
