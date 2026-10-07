import type { Scalar } from '../../pipeline/index.js';
import type { ComparisonOperator, ConditionScope, Expression } from '../condition.types.js';
import { conditionError } from '../condition.utils.js';
import { parseCondition } from './parse-condition.service.js';

/** A reported `"3"` and a declared `3` are the same number; nothing else is coerced. */
const asNumber = (value: Scalar): number | undefined => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)))
    return Number(value);
  return undefined;
};

const ORDERINGS: Readonly<
  Record<Exclude<ComparisonOperator, '==' | '!='>, (a: number, b: number) => boolean>
> = {
  '>': (a: number, b: number): boolean => a > b,
  '>=': (a: number, b: number): boolean => a >= b,
  '<': (a: number, b: number): boolean => a < b,
  '<=': (a: number, b: number): boolean => a <= b,
};

const sameValue = (left: Scalar, right: Scalar): boolean => {
  const [a, b]: [number | undefined, number | undefined] = [asNumber(left), asNumber(right)];
  const bothNumeric =
    a !== undefined && b !== undefined && (typeof left === 'number' || typeof right === 'number');
  return bothNumeric ? a === b : left === right;
};

/**
 * True or false, or an error — never a guess. A name nobody reported, an ordering of things that
 * are not numbers, a condition that is not a yes/no question: each stops the run instead of
 * quietly routing somewhere.
 */
export const evaluateCondition =
  (scope: ConditionScope) =>
  (source: string): boolean => {
    const valueOf = (expression: Expression): Scalar => {
      switch (expression.kind) {
        case 'literal':
          return expression.value;
        case 'name': {
          const value: Scalar | undefined = scope[expression.name];
          if (value === undefined)
            throw conditionError(source, `"${expression.name}" was never reported or declared`);
          return value;
        }
        case 'not':
          return !truthOf(expression.operand);
        case 'and':
          return truthOf(expression.left) && truthOf(expression.right);
        case 'or':
          return truthOf(expression.left) || truthOf(expression.right);
        case 'compare': {
          const [left, right]: [Scalar, Scalar] = [
            valueOf(expression.left),
            valueOf(expression.right),
          ];
          if (expression.operator === '==') return sameValue(left, right);
          if (expression.operator === '!=') return !sameValue(left, right);
          const [a, b]: [number | undefined, number | undefined] = [
            asNumber(left),
            asNumber(right),
          ];
          if (a === undefined || b === undefined) {
            throw conditionError(source, `"${expression.operator}" needs numbers on both sides`);
          }
          return ORDERINGS[expression.operator](a, b);
        }
      }
    };

    const truthOf = (expression: Expression): boolean => {
      const value: Scalar = valueOf(expression);
      if (typeof value !== 'boolean') throw conditionError(source, 'is not a yes/no question');
      return value;
    };

    return truthOf(parseCondition(source));
  };
