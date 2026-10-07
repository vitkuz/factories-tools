import { describe, expect, it } from 'vitest';
import {
  createClaudeAdapter,
  type ClaudeAdapterSettings,
  type ClaudePermissionMode,
} from '../src/adapters/claude/index.js';
import { eventFromLastLine } from '../src/adapters/claude/claude.utils.js';
import type { AgentRequest } from '../src/features/run/index.js';
import type { ProcessRequest, ProcessResult } from '../src/shared/utils/process.utils.js';

const REQUEST: AgentRequest = {
  stepName: 'review',
  prompt: 'Review it.',
  systemPrompt: 'You are strict.',
  model: 'opus',
  cwd: '/repo',
  allowedEvents: ['APPROVE', 'REVISE'],
};

const adapterWith = (
  reply: Partial<ProcessResult>,
  seen: ProcessRequest[] = [],
  permissionMode: ClaudePermissionMode = 'bypassPermissions',
) =>
  createClaudeAdapter({
    bin: 'claude',
    permissionMode,
    timeoutMs: 60_000,
    homePath: '/home/me',
    runProcess: async (request: ProcessRequest): Promise<ProcessResult> => {
      seen.push(request);
      return { exitCode: 0, stdout: '', stderr: '', ...reply };
    },
  } satisfies ClaudeAdapterSettings);

const result = (extra: Record<string, unknown>): string =>
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: 'abc',
    total_cost_usd: 0.5,
    ...extra,
  });

describe('claude adapter', () => {
  it('sends the prompt on stdin and the step on argv, with the events as an enum', async () => {
    const seen: ProcessRequest[] = [];
    await adapterWith(
      { stdout: result({ structured_output: { event: 'APPROVE' } }) },
      seen,
    ).runAgent({
      ...REQUEST,
      resumeSessionId: 'earlier',
    });
    const [call] = seen;
    const args: string[] = [...(call?.args ?? [])];

    expect(call?.input).toBe('Review it.');
    expect(call?.cwd).toBe('/repo');
    expect(args).toEqual(
      expect.arrayContaining([
        '--print',
        '--model',
        'opus',
        '--append-system-prompt',
        'You are strict.',
        '--resume',
        'earlier',
      ]),
    );
    expect(args.join(' ')).not.toContain('Review it.');
    expect(
      JSON.parse(args[args.indexOf('--json-schema') + 1] ?? '{}').properties.event.enum,
    ).toEqual(['APPROVE', 'REVISE']);
  });

  it('skips permissions with the dangerous flag by default, and names any other mode', async () => {
    const stdout = result({ structured_output: { event: 'APPROVE' } });
    const [byDefault, named]: [ProcessRequest[], ProcessRequest[]] = [[], []];
    await adapterWith({ stdout }, byDefault).runAgent(REQUEST);
    await adapterWith({ stdout }, named, 'acceptEdits').runAgent(REQUEST);

    expect(byDefault[0]?.args).toContain('--dangerously-skip-permissions');
    expect(byDefault[0]?.args).not.toContain('--permission-mode');
    expect(named[0]?.args.join(' ')).toContain('--permission-mode acceptEdits');
    expect(named[0]?.args).not.toContain('--dangerously-skip-permissions');
  });

  it('reads the event and the scalar report from the structured answer', async () => {
    const answer = await adapterWith({
      stdout: result({
        structured_output: {
          event: 'REVISE',
          report: { findings: 3, clean: false, nested: { no: 1 } },
        },
      }),
    }).runAgent(REQUEST);

    expect(answer).toMatchObject({
      event: 'REVISE',
      reported: { findings: 3, clean: false },
      sessionId: 'abc',
      costUsd: 0.5,
    });
    expect(answer.transcriptPath).toBe('/home/me/.claude/projects/-repo/abc.jsonl');
  });

  it('falls back to the last line, and names no event when that is not one either', async () => {
    expect(
      (
        await adapterWith({ stdout: result({ result: 'All good.\n\n**APPROVE**' }) }).runAgent(
          REQUEST,
        )
      ).event,
    ).toBe('APPROVE');
    expect(
      (await adapterWith({ stdout: result({ result: 'I approve of this.' }) }).runAgent(REQUEST))
        .event,
    ).toBeUndefined();
    expect(eventFromLastLine('APPROVE\nbut actually\n', ['APPROVE'])).toBeUndefined();
  });

  it('throws on a timeout, an empty answer and an error result', async () => {
    await expect(adapterWith({ killed: 'timeout' }).runAgent(REQUEST)).rejects.toThrow(
      'killed after 1 minutes',
    );
    await expect(
      adapterWith({ exitCode: 1, stderr: 'not logged in' }).runAgent(REQUEST),
    ).rejects.toThrow('not logged in');
    await expect(
      adapterWith({ stdout: result({ is_error: true, subtype: 'error_max_turns' }) }).runAgent(
        REQUEST,
      ),
    ).rejects.toThrow('error_max_turns');
  });
});
