import { describe, expect, it } from 'vitest';
import { createCodexAdapter, type CodexAdapterSettings } from '../src/adapters/codex/index.js';
import type { PermissionMode } from '../src/features/harness/index.js';
import type { ProcessRequest, ProcessResult } from '../src/shared/utils/process.utils.js';
import { REQUEST, fakeProcess, jsonLines, scratch } from './adapter-helpers.js';

const SCHEMA_FILE = '/repo/run/demo/.harness/review.answer-schema.json';

const adapterWith = (
  reply: Partial<ProcessResult>,
  seen: ProcessRequest[] = [],
  extra: Partial<CodexAdapterSettings> = {},
) =>
  createCodexAdapter({
    bin: 'codex',
    permissionMode: 'bypassPermissions',
    timeoutMs: 60_000,
    models: { opus: 'gpt-6-astra' },
    fileSystem: scratch(),
    tempDir: '/tmp',
    runProcess: fakeProcess(reply, seen),
    ...extra,
  } satisfies CodexAdapterSettings);

// The shapes below are the real ones quoted in harness-research.md.
const THREAD = { type: 'thread.started', thread_id: '01a0b086-41d4-7902-8ef8-7ad78cc44cc7' };
const USAGE = {
  type: 'turn.completed',
  usage: { input_tokens: 15505, cached_input_tokens: 100, output_tokens: 30 },
};
const message = (text: string): Record<string, unknown> => ({
  type: 'item.completed',
  item: { id: 'item_1', type: 'agent_message', text },
});
const answered = (text: string): string => jsonLines(THREAD, message(text), USAGE);

describe('codex adapter', () => {
  it('sends the prompt on stdin under its role, and the schema as a file in the run folder', async () => {
    const seen: ProcessRequest[] = [];
    const files = scratch();
    await adapterWith({ stdout: answered('{"event":"APPROVE"}') }, seen, {
      fileSystem: files,
    }).runAgent(REQUEST);
    const [call] = seen;

    expect(call?.args).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--output-schema',
      SCHEMA_FILE,
      '-m',
      'gpt-6-astra',
      '-C',
      '/repo',
      '--dangerously-bypass-approvals-and-sandbox',
      '-',
    ]);
    expect(call?.cwd).toBe('/repo');
    expect(call?.input?.startsWith('## Role\nYou are strict.')).toBe(true);
    expect(call?.input?.endsWith('Review it.')).toBe(true);
    expect(JSON.parse(files.written.get(SCHEMA_FILE) ?? '{}').properties.event.enum).toEqual([
      'APPROVE',
      'REVISE',
    ]);
  });

  it('retries with `exec resume <thread>`: no role, no -C, the sandbox as a config value', async () => {
    const seen: ProcessRequest[] = [];
    await adapterWith({ stdout: answered('{"event":"APPROVE"}') }, seen, {
      permissionMode: 'acceptEdits',
    }).runAgent({ ...REQUEST, prompt: 'Name the event.', resumeSessionId: 'thread-1' });
    const args: string[] = [...(seen[0]?.args ?? [])];

    expect(args.slice(0, 2)).toEqual(['exec', 'resume']);
    expect(args.slice(-2)).toEqual(['thread-1', '-']);
    expect(args.join(' ')).toContain('-c sandbox_mode="workspace-write"');
    expect(args).not.toContain('-C');
    expect(args).not.toContain('-s');
    expect(args).toContain('--output-schema');
    expect(seen[0]?.input).toBe('Name the event.');
  });

  it('passes no model flag for an unmapped tier, and the default model to a step with none', async () => {
    const [unmapped, unnamed]: [ProcessRequest[], ProcessRequest[]] = [[], []];
    const stdout = answered('{"event":"APPROVE"}');
    await adapterWith({ stdout }, unmapped).runAgent({ ...REQUEST, model: 'haiku' });
    const { model: _model, ...noModel } = REQUEST;
    await adapterWith({ stdout }, unnamed, { defaultModel: 'gpt-5.6-luna' }).runAgent(noModel);

    expect(unmapped[0]?.args).not.toContain('-m');
    expect(unnamed[0]?.args.join(' ')).toContain('-m gpt-5.6-luna');
  });

  it('never sends an agent profile: codex has no custom agents', async () => {
    const seen: ProcessRequest[] = [];
    await adapterWith({ stdout: answered('{"event":"APPROVE"}') }, seen).runAgent({
      ...REQUEST,
      agentProfile: 'strict-reviewer',
    });

    expect(seen[0]?.args.join(' ')).not.toContain('strict-reviewer');
  });

  it('reads the structured answer, the thread id and the tokens', async () => {
    const answer = await adapterWith({
      stdout: jsonLines(
        THREAD,
        message('Looking at the files first.'),
        message('{"event":"REVISE","report":{"findings":3,"nested":{"no":1}}}'),
        USAGE,
      ),
    }).runAgent(REQUEST);

    expect(answer).toMatchObject({
      event: 'REVISE',
      reported: { findings: 3 },
      sessionId: '01a0b086-41d4-7902-8ef8-7ad78cc44cc7',
      usage: { inputTokens: 15505, cachedInputTokens: 100, outputTokens: 30 },
    });
    expect(answer.costUsd).toBeUndefined();
    expect(answer.transcriptPath).toBeUndefined();
  });

  it('falls back to the last line, and names no event when that is not one either', async () => {
    expect(
      (await adapterWith({ stdout: answered('All good.\n\n**APPROVE**') }).runAgent(REQUEST)).event,
    ).toBe('APPROVE');
    const none = await adapterWith({ stdout: answered('I approve of this.') }).runAgent(REQUEST);
    expect(none.event).toBeUndefined();
    expect(none.sessionId).toBe(THREAD.thread_id);
  });

  it('throws on a timeout, an error event and an empty answer', async () => {
    await expect(adapterWith({ killed: 'timeout' }).runAgent(REQUEST)).rejects.toThrow(
      'killed after 1 minutes',
    );
    await expect(
      adapterWith({ exitCode: 1, stderr: 'not logged in' }).runAgent(REQUEST),
    ).rejects.toThrow('not logged in');
    await expect(
      adapterWith({
        exitCode: 1,
        stdout: jsonLines(THREAD, { type: 'turn.failed', error: { message: 'quota exceeded' } }),
      }).runAgent(REQUEST),
    ).rejects.toThrow('quota exceeded');
    await expect(
      adapterWith({
        exitCode: 1,
        stdout: jsonLines({ type: 'error', message: 'model not found' }),
      }).runAgent(REQUEST),
    ).rejects.toThrow('model not found');
    await expect(
      adapterWith({ stdout: jsonLines(THREAD, USAGE) }).runAgent(REQUEST),
    ).rejects.toThrow('without an answer');
  });

  it('does not fail a turn that completed after a reconnect notice', async () => {
    const answer = await adapterWith({
      stdout: jsonLines(
        THREAD,
        { type: 'error', message: 'stream error, retrying 1/5' },
        message('{"event":"APPROVE"}'),
        USAGE,
      ),
    }).runAgent(REQUEST);

    expect(answer.event).toBe('APPROVE');
  });

  it('maps the permission mode to a sandbox, and refuses what has no equivalent', async () => {
    const flagsFor = async (permissionMode: PermissionMode): Promise<string> => {
      const seen: ProcessRequest[] = [];
      await adapterWith({ stdout: answered('{"event":"APPROVE"}') }, seen, {
        permissionMode,
      }).runAgent(REQUEST);
      return (seen[0]?.args ?? []).join(' ');
    };

    expect(await flagsFor('acceptEdits')).toContain('-s workspace-write');
    expect(await flagsFor('plan')).toContain('-s read-only');
    expect(await flagsFor('acceptEdits')).not.toContain('--dangerously');
    (['auto', 'manual', 'dontAsk'] as PermissionMode[]).forEach((mode: PermissionMode): void => {
      expect((): unknown => adapterWith({}, [], { permissionMode: mode })).toThrow(
        `codex has no equivalent of permission mode "${mode}"`,
      );
    });
  });
});
