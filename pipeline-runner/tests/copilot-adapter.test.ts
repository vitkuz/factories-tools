import { describe, expect, it } from 'vitest';
import {
  createCopilotAdapter,
  type CopilotAdapterSettings,
} from '../src/adapters/copilot/index.js';
import type { PermissionMode } from '../src/features/harness/index.js';
import type { ProcessRequest, ProcessResult } from '../src/shared/utils/process.utils.js';
import { REQUEST, fakeProcess, jsonLines } from './adapter-helpers.js';

const adapterWith = (
  reply: Partial<ProcessResult>,
  seen: ProcessRequest[] = [],
  extra: Partial<CopilotAdapterSettings> = {},
) =>
  createCopilotAdapter({
    bin: 'copilot',
    permissionMode: 'bypassPermissions',
    timeoutMs: 60_000,
    models: { opus: 'claude-opus-5' },
    runProcess: fakeProcess(reply, seen),
    ...extra,
  } satisfies CopilotAdapterSettings);

// The shapes below are the real ones quoted in harness-research.md, noise lines included.
const NOISE = { type: 'session.mcp_server_status_changed', data: { name: 'github' } };
const RESULT = {
  type: 'result',
  sessionId: 'c18772f6-54e5-4454-815f-523f5fda13f7',
  exitCode: 0,
  usage: { premiumRequests: 1, sessionDurationMs: 17847 },
};
const message = (content: string): Record<string, unknown> => ({
  type: 'assistant.message',
  data: { content, model: 'claude-sonnet-5', toolRequests: [] },
});
const answered = (content: string): string => jsonLines(NOISE, message(content), RESULT);

describe('copilot adapter', () => {
  it('sends the prompt on stdin — role on top, report-block convention below — and no -p', async () => {
    const seen: ProcessRequest[] = [];
    await adapterWith({ stdout: answered('APPROVE') }, seen).runAgent({
      ...REQUEST,
      agentProfile: 'strict-reviewer',
    });
    const [call] = seen;

    expect(call?.args).toEqual([
      '--output-format',
      'json',
      '--allow-all',
      '--no-ask-user',
      '--model',
      'claude-opus-5',
      '--agent',
      'strict-reviewer',
    ]);
    expect(call?.args).not.toContain('-p');
    expect(call?.cwd).toBe('/repo');
    expect(call?.input?.startsWith('## Role\nYou are strict.')).toBe(true);
    expect(call?.input).toContain('Review it.');
    expect(call?.input).toContain('```json\n{"event": "<APPROVE | REVISE>", "report": {}}\n```');
  });

  it('retries with --resume=<id> and the bare retry prompt: the session knows the rest', async () => {
    const seen: ProcessRequest[] = [];
    await adapterWith({ stdout: answered('APPROVE') }, seen).runAgent({
      ...REQUEST,
      prompt: 'Name the event.',
      resumeSessionId: 'earlier',
    });

    expect(seen[0]?.args).toContain('--resume=earlier');
    expect(seen[0]?.input).toBe('Name the event.');
  });

  it('says when its usage covers the whole session: a resumed call reports the running total', async () => {
    const first = await adapterWith({ stdout: answered('APPROVE') }).runAgent(REQUEST);
    const resumed = await adapterWith({ stdout: answered('APPROVE') }).runAgent({
      ...REQUEST,
      resumeSessionId: 'earlier',
    });

    expect(first.usageCoversSession).toBe(false);
    expect(resumed.usageCoversSession).toBe(true);
  });

  it('reads the event and the report from the fenced block, the session and the premium requests', async () => {
    const answer = await adapterWith({
      stdout: jsonLines(
        NOISE,
        message(''),
        message('Found three.\n\n```json\n{"event":"REVISE","report":{"findings":3}}\n```'),
        RESULT,
      ),
    }).runAgent(REQUEST);

    expect(answer).toMatchObject({
      event: 'REVISE',
      reported: { findings: 3 },
      sessionId: 'c18772f6-54e5-4454-815f-523f5fda13f7',
      usage: { premiumRequests: 1 },
      durationMs: 17847,
    });
    expect(answer.costUsd).toBeUndefined();
    expect(answer.transcriptPath).toBeUndefined();
  });

  it('falls back to the last line, and names no event when that is not one either', async () => {
    expect((await adapterWith({ stdout: answered('1\n\nAPPROVE') }).runAgent(REQUEST)).event).toBe(
      'APPROVE',
    );
    const none = await adapterWith({ stdout: answered('I approve of this.') }).runAgent(REQUEST);
    expect(none.event).toBeUndefined();
    expect(none.sessionId).toBe(RESULT.sessionId);
  });

  it('throws on a timeout, a failed result, a refused model and an empty answer', async () => {
    await expect(adapterWith({ killed: 'timeout' }).runAgent(REQUEST)).rejects.toThrow(
      'killed after 1 minutes',
    );
    await expect(
      adapterWith({
        stdout: jsonLines(message('half'), { ...RESULT, exitCode: 1 }),
        stderr: 'rate limited',
      }).runAgent(REQUEST),
    ).rejects.toThrow('rate limited');
    // Real: 23 noise lines on stdout, exit 1, the reason on stderr, no `result` line at all.
    await expect(
      adapterWith({
        exitCode: 1,
        stdout: jsonLines(NOISE, NOISE),
        stderr: 'Error: Model "gpt-5-mini" from --model flag is not available.',
      }).runAgent(REQUEST),
    ).rejects.toThrow('is not available');
    await expect(
      adapterWith({ stdout: jsonLines(NOISE, RESULT) }).runAgent(REQUEST),
    ).rejects.toThrow('without an answer');
  });

  it('maps the permission mode to allow/deny rules, and refuses what has no equivalent', async () => {
    const flagsFor = async (permissionMode: PermissionMode): Promise<string> => {
      const seen: ProcessRequest[] = [];
      await adapterWith({ stdout: answered('APPROVE') }, seen, { permissionMode }).runAgent(
        REQUEST,
      );
      return (seen[0]?.args ?? []).join(' ');
    };

    expect(await flagsFor('acceptEdits')).toContain('--allow-tool=write');
    expect(await flagsFor('acceptEdits')).not.toContain('--allow-all');
    expect(await flagsFor('plan')).toContain(
      '--allow-all-tools --deny-tool=write --deny-tool=shell',
    );
    (['auto', 'manual', 'dontAsk'] as PermissionMode[]).forEach((mode: PermissionMode): void => {
      expect((): unknown => adapterWith({}, [], { permissionMode: mode })).toThrow(
        `copilot has no equivalent of permission mode "${mode}"`,
      );
    });
  });
});
