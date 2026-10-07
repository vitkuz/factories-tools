import type { Scalar } from '../pipeline/index.js';

export type ComparisonOperator = '>' | '>=' | '<' | '<=' | '==' | '!=';

export type Token =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'name'; value: string }
  | { kind: 'operator'; value: ComparisonOperator }
  | { kind: 'keyword'; value: 'and' | 'or' | 'not' | 'true' | 'false' }
  | { kind: 'paren'; value: '(' | ')' };

export type Expression =
  | { kind: 'literal'; value: Scalar }
  | { kind: 'name'; name: string }
  | { kind: 'not'; operand: Expression }
  | { kind: 'and' | 'or'; left: Expression; right: Expression }
  | { kind: 'compare'; operator: ComparisonOperator; left: Expression; right: Expression };

/** Bare names in a condition resolve against this. */
export type ConditionScope = Readonly<Record<string, Scalar>>;
