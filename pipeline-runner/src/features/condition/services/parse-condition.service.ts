import type { Expression, Token } from '../condition.types.js';
import { conditionError, tokenize } from '../condition.utils.js';

/** What every grammar rule returns: the expression it read, and where the next rule starts. */
type Parsed = [Expression, number];

/**
 *   or      := and ('or' and)*
 *   and     := not ('and' not)*
 *   not     := 'not' not | compare
 *   compare := primary (operator primary)?
 *   primary := number | string | true | false | name | '(' or ')'
 */
export const parseCondition = (source: string): Expression => {
  const tokens: Token[] = tokenize(source);
  const isKeyword = (at: number, word: string): boolean => {
    const token: Token | undefined = tokens[at];
    return token?.kind === 'keyword' && token.value === word;
  };

  const primary = (at: number): Parsed => {
    const token: Token | undefined = tokens[at];
    if (token === undefined) throw conditionError(source, 'ends where a value was expected');
    if (token.kind === 'number' || token.kind === 'string')
      return [{ kind: 'literal', value: token.value }, at + 1];
    if (token.kind === 'name') return [{ kind: 'name', name: token.value }, at + 1];
    if (token.kind === 'keyword' && (token.value === 'true' || token.value === 'false')) {
      return [{ kind: 'literal', value: token.value === 'true' }, at + 1];
    }
    if (token.kind === 'paren' && token.value === '(') {
      const [inner, next]: Parsed = or(at + 1);
      const closing: Token | undefined = tokens[next];
      if (closing?.kind !== 'paren' || closing.value !== ')')
        throw conditionError(source, 'a "(" is never closed');
      return [inner, next + 1];
    }
    throw conditionError(source, `unexpected "${String(token.value)}"`);
  };

  const compare = (at: number): Parsed => {
    const [left, next]: Parsed = primary(at);
    const token: Token | undefined = tokens[next];
    if (token?.kind !== 'operator') return [left, next];
    const [right, after]: Parsed = primary(next + 1);
    return [{ kind: 'compare', operator: token.value, left, right }, after];
  };

  const not = (at: number): Parsed => {
    if (!isKeyword(at, 'not')) return compare(at);
    const [operand, next]: Parsed = not(at + 1);
    return [{ kind: 'not', operand }, next];
  };

  const chain =
    (word: 'and' | 'or', operand: (at: number) => Parsed) =>
    (at: number): Parsed => {
      const extend = ([left, next]: Parsed): Parsed => {
        if (!isKeyword(next, word)) return [left, next];
        const [right, after]: Parsed = operand(next + 1);
        return extend([{ kind: word, left, right }, after]);
      };
      return extend(operand(at));
    };

  const and = chain('and', not);
  const or: (at: number) => Parsed = chain('or', (at: number): Parsed => and(at));

  const [expression, end]: Parsed = or(0);
  if (end !== tokens.length)
    throw conditionError(source, `unexpected "${String(tokens[end]?.value)}"`);
  return expression;
};
