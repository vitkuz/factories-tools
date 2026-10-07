import { describe, expect, it } from 'vitest';
import { evaluateCondition } from '../src/features/condition/index.js';

const evaluate = evaluateCondition({
  findings: 3,
  score: 8,
  status: 'clean',
  retries: 1,
  threshold: 2,
  ok: true,
  text: '5',
});

describe('evaluateCondition', () => {
  it.each([
    ['findings > 1', true],
    ['findings > 5', false],
    ["score >= 8 and status == 'clean'", true],
    ["score >= 9 and status == 'clean'", false],
    ['not (retries > threshold)', true],
    ['findings < 1 or ok', true],
    ['not ok or findings == 3', true],
    ['text == 5', true],
    ['text > 4', true],
    ['status != "dirty"', true],
    ['ok', true],
    ['a_or_b == 1 or true', true],
  ])('%s → %s', (source: string, expected: boolean) => {
    expect(
      evaluateCondition({
        ...{ a_or_b: 1 },
        findings: 3,
        score: 8,
        status: 'clean',
        retries: 1,
        threshold: 2,
        ok: true,
        text: '5',
      })(source),
    ).toBe(expected);
  });

  it.each([
    'missing > 1',
    'findings',
    'status > 1',
    'findings >',
    '(findings > 1',
    'findings > 1 )',
    'findings $ 1',
  ])('refuses "%s"', (source: string) => {
    expect(() => evaluate(source)).toThrow();
  });
});
