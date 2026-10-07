// Learned from factories-tools/pipeline-validation/src/features/rules/rules.utils.ts
import type { Finding, Report, Rule, RuleMeta, Severity } from './rules.types.js';

const findingOf =
  (rule: string) =>
  (severity: Severity) =>
  (message: string): Finding => ({ rule, severity, message });

export const reportFor = (rule: string): Report => ({
  error: findingOf(rule)('error'),
  warning: findingOf(rule)('warning'),
});

/** The one way to write a rule: the check gets the context and a `report` stamping the rule id. */
export const defineRule =
  <Context>(meta: RuleMeta) =>
  (check: (context: Context, report: Report) => Finding[]): Rule<Context> => ({
    ...meta,
    check: (context: Context): Finding[] => check(context, reportFor(meta.id)),
  });

/** Run every rule against one context, in order. */
export const runRules =
  <Context>(rules: readonly Rule<Context>[]) =>
  (context: Context): Finding[] =>
    rules.flatMap((rule: Rule<Context>): Finding[] => rule.check(context));
