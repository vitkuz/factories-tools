import { createAppError } from '../../../shared/utils/error.utils.js';
import type { ParamValues, PipelineDefinition, Scalar } from '../pipeline.types.js';
import { coerceToDefault, type Coerced } from '../pipeline.utils.js';

type ParamOutcome = { name: string; value: Scalar } | { name: string; issue: string };

const resolveOne =
  (supplied: Readonly<Record<string, string>>) =>
  ([name, fallback]: [string, Scalar]): ParamOutcome => {
    const given: string | undefined = supplied[name];
    if (given === undefined) {
      // An empty default means "there is no default": a person would be asked, a CLI refuses.
      return fallback === ''
        ? { name, issue: `param "${name}" has no default — pass --param ${name}=...` }
        : { name, value: fallback };
    }
    const coerced: Coerced = coerceToDefault(fallback)(given);
    return coerced.ok
      ? { name, value: coerced.value }
      : { name, issue: `param "${name}": ${coerced.reason}` };
  };

/** The caller's `name=value` pairs laid over the declared defaults, typed like the defaults. */
export const resolveParams =
  (definition: PipelineDefinition) =>
  (supplied: Readonly<Record<string, string>>): ParamValues => {
    const declared: string[] = Object.keys(definition.params);
    const outcomes: ParamOutcome[] = Object.entries(definition.params).map(resolveOne(supplied));
    const issues: string[] = [
      ...Object.keys(supplied)
        .filter((name: string): boolean => !declared.includes(name))
        .map(
          (name: string): string =>
            `no such param "${name}" — this pipeline declares ${declared.join(', ') || 'none'}`,
        ),
      ...outcomes.flatMap((outcome: ParamOutcome): string[] =>
        'issue' in outcome ? [outcome.issue] : [],
      ),
    ];
    if (issues.length > 0)
      throw createAppError('PARAMS_INVALID', 'the params do not fit this pipeline', issues);
    return Object.fromEntries(
      outcomes.flatMap((outcome: ParamOutcome): [string, Scalar][] =>
        'value' in outcome ? [[outcome.name, outcome.value]] : [],
      ),
    );
  };
