import { describe, expect, it } from 'vitest';
import { createAgyAdapter, type AgyAdapterSettings } from '../src/adapters/agy/index.js';
import type { PermissionMode } from '../src/features/harness/index.js';
import type { ProcessRequest, ProcessResult } from '../src/shared/utils/process.utils.js';
import { REQUEST, fakeProcess, scratch } from './adapter-helpers.js';

const adapterWith = (
  reply: Partial<ProcessResult>,
  seen: ProcessRequest[] = [],
  extra: Partial<AgyAdapterSettings> = {},
) =>
  createAgyAdapter({
    bin: 'agy',
    permissionMode: 'bypassPermissions',
    timeoutMs: 90 * 60_000,
    models: { opus: 'gemini-3.1-pro-high' },
    fileSystem: scratch(),
    tempDir: '/tmp',
    runProcess: fakeProcess(reply, seen),
    ...extra,
  } satisfies AgyAdapterSettings);

// The shape below is the real one quoted in harness-research.md.
const result = (extra: Record<string, unknown>): string =>
  JSON.stringify({
    conversation_id: '2cfed44b-0000-4000-8000-000000000000',
    status: 'SUCCESS',
    response: '',
    duration_seconds: 1.5,
    usage: { input_tokens: 14173, output_tokens: 9, cache_read_tokens: 0 },
    ...extra,
  });

const valueOf = (args: readonly string[], flag: string): string | undefined =>
  args[args.indexOf(flag) + 1];

describe('agy adapter', () => {
  it('sends the prompt on argv as --print=<role + prompt>, never on stdin', async () => {
    const seen: ProcessRequest[] = [];
    await adapterWith(
      { stdout: result({ structured_output: { event: 'APPROVE' } }) },
      seen,
    ).runAgent({
      ...REQUEST,
      agentProfile: 'strict-reviewer',
    });
    const args: string[] = [...(seen[0]?.args ?? [])];

    expect(args[0]?.startsWith('--print=## Role\nYou are strict.')).toBe(true);
    expect(args[0]?.endsWith('Review it.')).toBe(true);
    expect(seen[0]?.input).toBeUndefined();
    expect(seen[0]?.cwd).toBe('/repo');
    expect(valueOf(args, '--output-format')).toBe('json');
    expect(valueOf(args, '--model')).toBe('gemini-3.1-pro-high');
    expect(valueOf(args, '--agent')).toBe('strict-reviewer');
    expect(args).toContain('--dangerously-skip-permissions');
    expect(JSON.parse(valueOf(args, '--json-schema') ?? '{}').properties.event.enum).toEqual([
      'APPROVE',
      'REVISE',
    ]);
  });

  it("raises agy's own 5-minute print timeout to the step timeout", async () => {
    const seen: ProcessRequest[] = [];
    await adapterWith(
      { stdout: result({ structured_output: { event: 'APPROVE' } }) },
      seen,
    ).runAgent(REQUEST);

    expect(valueOf(seen[0]?.args ?? [], '--print-timeout')).toBe('5400s');
  });

  it('retries with --conversation <id> and the bare retry prompt', async () => {
    const seen: ProcessRequest[] = [];
    await adapterWith(
      { stdout: result({ structured_output: { event: 'APPROVE' } }) },
      seen,
    ).runAgent({
      ...REQUEST,
      prompt: 'Name the event.',
      resumeSessionId: 'earlier',
    });
    const args: string[] = [...(seen[0]?.args ?? [])];

    expect(args[0]).toBe('--print=Name the event.');
    expect(valueOf(args, '--conversation')).toBe('earlier');
  });

  it('writes a prompt too large for argv into the run folder and sends a pointer to it', async () => {
    const seen: ProcessRequest[] = [];
    const files = scratch();
    const prompt: string = 'x'.repeat(2_000);
    await adapterWith({ stdout: result({ structured_output: { event: 'APPROVE' } }) }, seen, {
      fileSystem: files,
      maxArgvPromptBytes: 1_000,
    }).runAgent({ ...REQUEST, prompt });
    const promptFile = '/repo/run/demo/.harness/review.prompt.md';

    expect(files.written.get(promptFile)?.startsWith('## Role\nYou are strict.')).toBe(true);
    expect(files.written.get(promptFile)?.endsWith(prompt)).toBe(true);
    expect(seen[0]?.args[0]).toContain(promptFile);
    expect((seen[0]?.args[0] ?? '').length).toBeLessThan(1_000);
  });

  it('reads the structured answer, the conversation id and the tokens', async () => {
    const answer = await adapterWith({
      stdout: result({
        response: '1{…}\n',
        structured_output: { event: 'REVISE', report: { findings: 3, nested: { no: 1 } } },
      }),
    }).runAgent(REQUEST);

    expect(answer).toMatchObject({
      event: 'REVISE',
      reported: { findings: 3 },
      text: '1{…}\n',
      sessionId: '2cfed44b-0000-4000-8000-000000000000',
      usage: { inputTokens: 14173, outputTokens: 9, cachedInputTokens: 0 },
      durationMs: 1500,
    });
    expect(answer.costUsd).toBeUndefined();
    expect(answer.transcriptPath).toBeUndefined();
  });

  it('falls back to the last line, and names no event when that is not one either', async () => {
    expect(
      (await adapterWith({ stdout: result({ response: 'Fine.\nAPPROVE\n' }) }).runAgent(REQUEST))
        .event,
    ).toBe('APPROVE');
    expect(
      (await adapterWith({ stdout: result({ response: 'I approve.' }) }).runAgent(REQUEST)).event,
    ).toBeUndefined();
  });

  it('throws on a timeout, an error result, a bad status and an empty answer', async () => {
    await expect(adapterWith({ killed: 'timeout' }).runAgent(REQUEST)).rejects.toThrow(
      'killed after 90 minutes',
    );
    await expect(
      adapterWith({
        exitCode: 1,
        stdout: result({
          conversation_id: '',
          status: 'ERROR',
          error: 'invalid model selection (--model "no-such-model")',
        }),
      }).runAgent(REQUEST),
    ).rejects.toThrow('invalid model selection');
    await expect(
      adapterWith({ stdout: result({ status: 'CANCELLED', response: 'half' }) }).runAgent(REQUEST),
    ).rejects.toThrow('status CANCELLED');
    await expect(adapterWith({ stdout: result({}) }).runAgent(REQUEST)).rejects.toThrow(
      'without an answer',
    );
    await expect(adapterWith({ stdout: 'not json' }).runAgent(REQUEST)).rejects.toThrow(
      'unexpected result',
    );
  });

  it('maps the permission mode to --mode, and refuses what has no equivalent', async () => {
    const flagsFor = async (permissionMode: PermissionMode): Promise<string> => {
      const seen: ProcessRequest[] = [];
      await adapterWith({ stdout: result({ structured_output: { event: 'APPROVE' } }) }, seen, {
        permissionMode,
      }).runAgent(REQUEST);
      return (seen[0]?.args ?? []).slice(1).join(' ');
    };

    expect(await flagsFor('acceptEdits')).toContain('--mode accept-edits');
    expect(await flagsFor('acceptEdits')).not.toContain('--dangerously-skip-permissions');
    expect(await flagsFor('plan')).toContain('--mode plan');
    (['auto', 'manual', 'dontAsk'] as PermissionMode[]).forEach((mode: PermissionMode): void => {
      expect((): unknown => adapterWith({}, [], { permissionMode: mode })).toThrow(
        `agy has no equivalent of permission mode "${mode}"`,
      );
    });
  });
});
