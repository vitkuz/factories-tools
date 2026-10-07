// Learned from factories-tools/run-state/tests/condition.test.ts
import { describe, expect, it } from 'vitest';
import { evaluateCondition, lookupIn, tokenize } from '../../src/features/routing/index.js';
import type { ConditionScopes } from '../../src/features/routing/index.js';

const scopes = (vars: Record<string, unknown> = {}): ConditionScopes => ({
  vars,
  params: { topic: 'cats', level: 2, lang: 'en' },
  constants: { tone: 'plain', level: 'constant' },
  builtIns: { id: 'demo', date: '2026-10-07', slug: 'my-topic' },
});

const evaluate = (text: string, vars: Record<string, unknown> = {}) =>
  evaluateCondition(lookupIn(scopes(vars)))(text);

describe('tokenize', () => {
  it('splits operators, parentheses, quoted text, numbers and names', () => {
    expect(tokenize("score >= 8 and (lang == 'en' or not done) and x != -1.5")).toEqual({
      ok: true,
      value: [
        'score',
        '>=',
        '8',
        'and',
        '(',
        'lang',
        '==',
        "'en'",
        'or',
        'not',
        'done',
        ')',
        'and',
        'x',
        '!=',
        '-1.5',
      ],
    });
  });

  it('says where it stops making sense', () => {
    expect(tokenize('a @ b')).toMatchObject({ ok: false });
  });
});

describe('evaluateCondition', () => {
  it('reads names from reported values first, then params, constants, built-ins', () => {
    expect(evaluate('level > 5', { level: 9 })).toEqual({ ok: true, value: true });
    expect(evaluate('level > 5')).toEqual({ ok: true, value: false });
    expect(evaluate("tone == 'plain'")).toEqual({ ok: true, value: true });
    expect(evaluate("slug == 'my-topic'")).toEqual({ ok: true, value: true });
  });

  it('compares loosely, like the recorder', () => {
    expect(evaluate("findings == '3'", { findings: 3 })).toEqual({ ok: true, value: true });
    expect(evaluate('findings != 3', { findings: 3 })).toEqual({ ok: true, value: false });
  });

  it('knows and, or, not and parentheses', () => {
    expect(evaluate("lang == 'en' and level < 3")).toEqual({ ok: true, value: true });
    expect(evaluate("lang == 'de' or level < 3")).toEqual({ ok: true, value: true });
    expect(evaluate("not (lang == 'en')")).toEqual({ ok: true, value: false });
    expect(evaluate('true and false')).toEqual({ ok: true, value: false });
  });

  it('refuses an unknown name, bad syntax and trailing tokens', () => {
    expect(evaluate('score > 1')).toMatchObject({
      ok: false,
      error: expect.stringContaining('"score"'),
    });
    expect(evaluate('level >')).toMatchObject({ ok: false });
    expect(evaluate('level > 1 2')).toMatchObject({
      ok: false,
      error: expect.stringContaining('extra'),
    });
  });
});
