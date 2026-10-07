// Learned from factories-tools/pipeline-state/src/features/commands/params.utils.ts
import type { Result } from '../../../shared/types/result.types.js';
import { ok, refuse } from '../../../shared/utils/result.utils.js';
import type { ParamValues, Pipeline, Scalar } from '../pipeline.types.js';

type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

const TRUE: readonly string[] = ['true', '1', 'yes'];
const FALSE: readonly string[] = ['false', '0', 'no'];

export const PARAM_CHECKS = {
  known: { id: 'param-known', description: 'Every -p name is a param the pipeline declares.' },
  fits: {
    id: 'param-fits-type',
    description:
      "Every -p value takes its default's type (a number for a number, a whole number for an integer, true/false/1/0/yes/no for a boolean).",
  },
  given: {
    id: 'param-has-value',
    description: 'Every param with an empty default (ask the user) is given a value.',
  },
} as const;

/**
 * A param keeps the type of its default: "5" becomes 5 for a numeric default and stays "5" for a
 * text one. A value that cannot take the default's type is an error.
 */
export const coerceParam =
  (name: string, fallback: Scalar) =>
  (raw: string): Outcome<Scalar> => {
    if (typeof fallback === 'boolean') {
      const lower: string = raw.toLowerCase();
      if (TRUE.includes(lower)) return { ok: true, value: true };
      if (FALSE.includes(lower)) return { ok: true, value: false };
      return { ok: false, error: `-p ${name}: "${raw}" is not a boolean` };
    }
    if (typeof fallback === 'number') {
      const parsed: number = Number(raw);
      if (raw.trim() === '' || Number.isNaN(parsed)) {
        return { ok: false, error: `-p ${name}: "${raw}" is not a number` };
      }
      if (Number.isInteger(fallback) && !Number.isInteger(parsed)) {
        return { ok: false, error: `-p ${name}: "${raw}" is not a whole number` };
      }
      return { ok: true, value: parsed };
    }
    return { ok: true, value: raw };
  };

/** The run's params: the caller's values laid over the declared defaults, typed like the defaults. */
export const resolveParams =
  (pipeline: Pipeline) =>
  (supplied: Readonly<Record<string, string>>): Result<ParamValues> => {
    const declared: Record<string, Scalar> = pipeline.params ?? {};
    const unknown: string[] = Object.keys(supplied).filter(
      (name: string): boolean => !Object.hasOwn(declared, name),
    );
    if (unknown.length > 0) {
      return refuse(PARAM_CHECKS.known.id)(
        `unknown param(s) ${unknown.join(', ')}: this pipeline declares ${Object.keys(declared).join(', ') || 'none'}`,
      );
    }
    const outcomes: [string, Outcome<Scalar>][] = Object.entries(declared).map(
      ([name, fallback]: [string, Scalar]): [string, Outcome<Scalar>] => [
        name,
        Object.hasOwn(supplied, name)
          ? coerceParam(name, fallback)(supplied[name] as string)
          : { ok: true, value: fallback },
      ],
    );
    const misfit: [string, Outcome<Scalar>] | undefined = outcomes.find(
      ([, outcome]: [string, Outcome<Scalar>]): boolean => !outcome.ok,
    );
    if (misfit !== undefined && !misfit[1].ok) return refuse(PARAM_CHECKS.fits.id)(misfit[1].error);
    const blank: string[] = outcomes
      .filter(
        ([, outcome]: [string, Outcome<Scalar>]): boolean => outcome.ok && outcome.value === '',
      )
      .map(([name]: [string, Outcome<Scalar>]): string => name);
    if (blank.length > 0) {
      return refuse(PARAM_CHECKS.given.id)(
        `param(s) ${blank.join(', ')} have no default: pass -p ${blank[0]}=<value>`,
      );
    }
    return ok(
      Object.fromEntries(
        outcomes.map(([name, outcome]: [string, Outcome<Scalar>]): [string, Scalar] => [
          name,
          outcome.ok ? outcome.value : '',
        ]),
      ),
    );
  };
