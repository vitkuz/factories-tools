import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import type { FactoryParam } from '../src/features/pipelines/pipelines.types.js';
import {
  buildFactoryParamsPrompt,
  buildFactoryPrompt,
  buildHookSettings,
  buildSessionEnv,
  buildSessionMeta,
  buildSessionName,
  formatAge,
  formatParamArg,
  formatParamValue,
  matchesFactoryId,
  parseSessionMeta,
  resolveStartParams,
  shellQuote,
  stripFactorySuffix,
  toFactorySession,
} from '../src/features/sessions/sessions.utils.js';
import type { FactorySession, SessionMeta } from '../src/features/sessions/sessions.types.js';

describe('session naming', () => {
  it('strips -factory and keeps eight hex chars of the uuid', () => {
    expect(buildSessionName('canonical-factory', '7f3a9c2b-1111-2222-3333-444444444444')).toBe(
      'factory-canonical-7f3a9c2b',
    );
  });

  it('leaves an id without the suffix alone', () => {
    expect(stripFactorySuffix('research')).toBe('research');
    expect(stripFactorySuffix('research-factory')).toBe('research');
  });

  it('builds the prompt as the skill invocation followed by the message', () => {
    expect(buildFactoryPrompt('research-factory', 'AI dark factories')).toBe(
      '/research-factory AI dark factories',
    );
  });
});

describe('formatAge', () => {
  it.each([
    [0, '0s'],
    [59, '59s'],
    [60, '1m'],
    [3_600, '1h'],
    [3_600 + 14 * 60, '1h 14m'],
    [86_400, '1d'],
    [86_400 + 3 * 3_600 + 5, '1d 3h'],
  ])('%d seconds -> %s', (seconds: number, expected: string) => {
    expect(formatAge(seconds)).toBe(expected);
  });
});

describe('toFactorySession', () => {
  const now: Date = new Date('2026-09-14T12:00:00Z');

  it('reads the meta when present, with the herdr status and ids', () => {
    const result: FactorySession = toFactorySession(
      { workspaceId: 'w4', label: 'factory-research-7f3a9c2b', status: 'idle' },
      { paneId: 'w4:p1', workspaceId: 'w4', cwd: '/work', status: 'blocked' },
      {
        session: 'factory-research-7f3a9c2b',
        factoryId: 'research-factory',
        harness: 'claude',
        startedAt: '2026-09-14T11:55:00.000Z',
      },
      now,
    );
    expect(result).toEqual({
      session: 'factory-research-7f3a9c2b',
      factoryId: 'research-factory',
      harness: 'claude',
      startedAt: '2026-09-14T11:55:00.000Z',
      ageSeconds: 300,
      age: '5m',
      status: 'blocked',
      workspaceId: 'w4',
      paneId: 'w4:p1',
    });
  });

  it('falls back to the name when there is no meta', () => {
    const result: FactorySession = toFactorySession(
      { workspaceId: 'w5', label: 'factory-improve-frontend-0badf00d', status: 'unknown' },
      undefined,
      null,
      now,
    );
    expect(result.factoryId).toBe('improve-frontend-factory');
    expect(result.harness).toBe('unknown');
    expect(result.ageSeconds).toBe(0);
    expect(result.status).toBe('unknown');
  });

  it('parseSessionMeta accepts only a complete meta', () => {
    expect(parseSessionMeta({ session: 'a' })).toBeNull();
    expect(parseSessionMeta('x')).toBeNull();
    const meta: SessionMeta = buildSessionMeta(
      { session: 'factory-a-00000000', factoryId: 'a-factory', harness: 'agy' },
      now,
    );
    expect(parseSessionMeta(JSON.parse(JSON.stringify(meta)))).toEqual(meta);
  });
});

describe('matchesFactoryId', () => {
  const s: FactorySession = {
    session: 'factory-research-7f3a9c2b',
    factoryId: 'research-factory',
    harness: 'copilot',
    startedAt: '',
    ageSeconds: 0,
    age: '0s',
  };
  it('matches the id with or without the suffix, and nothing else', () => {
    expect(matchesFactoryId(s, 'research-factory')).toBe(true);
    expect(matchesFactoryId(s, 'research')).toBe(true);
    expect(matchesFactoryId(s, 'canonical-factory')).toBe(false);
  });
});

describe('shellQuote', () => {
  it('wraps in single quotes and escapes embedded ones', () => {
    expect(shellQuote('/tmp/a b')).toBe(`'/tmp/a b'`);
    expect(shellQuote(`it's`)).toBe(`'it'\\''s'`);
  });
});

describe('hook settings', () => {
  it('wires PreToolUse (long timeout) and PostToolUse on AskUserQuestion to one quoted command', () => {
    const settings = buildHookSettings('/opt/node 22/bin/node', '/srv/api/hooks/h.mjs') as {
      hooks: Record<string, { matcher: string; hooks: { command: string; timeout?: number }[] }[]>;
    };
    const command = `'/opt/node 22/bin/node' '/srv/api/hooks/h.mjs'`;
    expect(settings.hooks.PreToolUse).toEqual([
      { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command, timeout: 3600 }] },
    ]);
    expect(settings.hooks.PostToolUse).toEqual([
      { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command }] },
    ]);
  });

  it('adds the session id to the shared environment without touching it', () => {
    const base = { STUDIO_API_URL: 'http://127.0.0.1:3100' };
    expect(buildSessionEnv(base, 's1')).toEqual({ ...base, STUDIO_SESSION_ID: 's1' });
    expect(base).toEqual({ STUDIO_API_URL: 'http://127.0.0.1:3100' });
  });
});

/** What `sh` makes of one word: the quoting is right when this gives back `name=value`. */
const shellWord = (word: string): string =>
  execFileSync('sh', ['-c', `printf '%s' ${word}`], { encoding: 'utf8' });

describe('formatParamValue / formatParamArg', () => {
  it('leaves a plain word bare and quotes everything else', () => {
    expect(formatParamValue('English')).toBe('English');
    expect(formatParamValue('calendly.com/openhome-support/30min')).toBe(
      'calendly.com/openhome-support/30min',
    );
    expect(formatParamValue(5)).toBe('5');
    expect(formatParamValue(true)).toBe('true');
    expect(formatParamValue('')).toBe('""');
    expect(formatParamValue('an executive')).toBe('"an executive"');
    expect(formatParamValue('Женя')).toBe('"Женя"');
  });

  it('escapes what is special inside double quotes and keeps newlines', () => {
    expect(formatParamValue('say "hi"')).toBe('"say \\"hi\\""');
    expect(formatParamValue('cost $5 `now` \\ ok')).toBe('"cost \\$5 \\`now\\` \\\\ ok"');
    expect(formatParamValue("it's\nfine")).toBe(`"it's\nfine"`);
  });

  it.each([
    'studio question test',
    `it's "quoted"`,
    'two\nlines\n\nand a gap',
    '$(touch /tmp/pwned) `id` $HOME \\n',
    'tab\there; & | > < * ? ~ # !',
    '',
    'Женя LN',
  ])('the shell reads %j back intact', (value: string) => {
    expect(shellWord(formatParamArg(['label', value]))).toBe(`label=${value}`);
  });
});

describe('buildFactoryParamsPrompt', () => {
  it('the skill, then name=value per param, then the extra instructions after a blank line', () => {
    expect(
      buildFactoryParamsPrompt(
        'quick-research-factory',
        [
          ['topic', 'AI agents in retail'],
          ['sub_questions', 3],
          ['language', 'English'],
        ],
        '',
      ),
    ).toBe('/quick-research-factory topic="AI agents in retail" sub_questions=3 language=English');
    expect(buildFactoryParamsPrompt('x-factory', [['label', 'a']], 'Be brief.')).toBe(
      '/x-factory label=a\n\nExtra instructions: Be brief.',
    );
  });
});

describe('resolveStartParams', () => {
  const declared: FactoryParam[] = [
    { name: 'topic', type: 'string', default: '', required: true, main: true },
    { name: 'sub_questions', type: 'number', default: 5, required: false, main: false },
    { name: 'ratio', type: 'number', default: 0.5, required: false, main: false },
    { name: 'deep', type: 'boolean', default: false, required: false, main: false },
  ];

  it('coerces to the default type and fills the missing optional ones, in declaration order', () => {
    expect(
      resolveStartParams(declared, { deep: 'yes', topic: 'x y', sub_questions: '7', ratio: 1.5 }),
    ).toEqual({
      ok: true,
      params: [
        ['topic', 'x y'],
        ['sub_questions', 7],
        ['ratio', 1.5],
        ['deep', true],
      ],
    });
    expect(resolveStartParams(declared, { topic: 't' })).toEqual({
      ok: true,
      params: [
        ['topic', 't'],
        ['sub_questions', 5],
        ['ratio', 0.5],
        ['deep', false],
      ],
    });
  });

  it('names every problem: unknown, missing required, wrong type', () => {
    expect(resolveStartParams(declared, { other: 1, sub_questions: '', deep: 2 })).toEqual({
      ok: false,
      issues: [
        { path: ['params', 'other'], message: 'is not a param of this factory' },
        { path: ['params', 'topic'], message: 'is required' },
        { path: ['params', 'sub_questions'], message: '"" is not a number' },
        { path: ['params', 'deep'], message: '"2" is not a boolean' },
      ],
    });
  });
});
