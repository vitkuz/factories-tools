import { createAppError } from '../../shared/utils/error.utils.js';
import type { ComparisonOperator, Token } from './condition.types.js';

const KEYWORDS: readonly string[] = ['and', 'or', 'not', 'true', 'false'];

/** Longest first, so `>=` is never read as `>` then `=`. */
const LEXEMES: readonly [RegExp, (text: string) => Token][] = [
  [/^\d+(\.\d+)?/, (text: string): Token => ({ kind: 'number', value: Number(text) })],
  [
    /^'([^']*)'|^"([^"]*)"/,
    (text: string): Token => ({ kind: 'string', value: text.slice(1, -1) }),
  ],
  [
    /^(>=|<=|==|!=|>|<)/,
    (text: string): Token => ({ kind: 'operator', value: text as ComparisonOperator }),
  ],
  [/^[()]/, (text: string): Token => ({ kind: 'paren', value: text as '(' | ')' })],
  [
    /^[a-zA-Z_][a-zA-Z0-9_]*/,
    (text: string): Token =>
      KEYWORDS.includes(text)
        ? { kind: 'keyword', value: text as 'and' | 'or' | 'not' | 'true' | 'false' }
        : { kind: 'name', value: text },
  ],
];

export const conditionError = (source: string, reason: string): Error =>
  createAppError('CONDITION_INVALID', `condition "${source}": ${reason}`, [reason]);

export const tokenize = (source: string): Token[] => {
  const scan = (rest: string, tokens: readonly Token[]): Token[] => {
    const text = rest.trimStart();
    if (text === '') return [...tokens];
    for (const [pattern, toToken] of LEXEMES) {
      const match: RegExpMatchArray | null = text.match(pattern);
      if (match) return scan(text.slice(match[0].length), [...tokens, toToken(match[0])]);
    }
    throw conditionError(source, `unexpected "${text[0] ?? ''}"`);
  };
  return scan(source, []);
};
