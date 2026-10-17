import path from 'node:path';
import type { Step } from '../../pipeline/pipeline.types.js';
import type { Finding, PipelineContext, PipelineRule, Report } from '../rules.types.js';
import { BlockedOutputNameSchema } from '../rules.schema.js';
import { defineRule } from '../rules.utils.js';
import { stepEntries } from '../../pipeline/pipeline.utils.js';

/** A bracket pattern with more spellings than this is treated as open-ended. */
const MAX_SPELLINGS = 256;

const TOKEN: RegExp = /\[([!^]?)([^\]]+)\]|(.)/gs;
const CLASS_PART: RegExp = /(.)-(.)|(.)/gs;

const charRange = (from: string, to: string): string[] =>
  Array.from(
    { length: Math.max(0, to.charCodeAt(0) - from.charCodeAt(0) + 1) },
    (_: unknown, offset: number): string => String.fromCharCode(from.charCodeAt(0) + offset),
  );

/** The characters a `[...]` body matches: `abc`, `a-z`. */
const classChars = (body: string): string[] =>
  [...body.matchAll(CLASS_PART)].flatMap((part: RegExpMatchArray): string[] =>
    part[3] !== undefined ? [part[3]] : charRange(part[1] ?? '', part[2] ?? ''),
  );

/** One position of a basename pattern: the characters it may be, or undefined when open-ended. */
const tokenChoices = (token: RegExpMatchArray): string[] | undefined => {
  const [, negated, body, literal]: (string | undefined)[] = [...token];
  if (literal !== undefined) return literal === '*' || literal === '?' ? undefined : [literal];
  return negated !== '' ? undefined : classChars(body ?? '');
};

const product = (spellings: readonly string[], choices: readonly string[]): string[] =>
  spellings.flatMap((head: string): string[] =>
    choices.map((choice: string): string => head + choice),
  );

/**
 * Every name a basename pattern can match, when that set is finite and small: a literal name is
 * itself, `[Ss]ummary.md` is two names, anything with `*`, `?` or `[!…]` is open-ended (undefined).
 */
export const spellingsOf = (basename: string): string[] | undefined =>
  [...basename.matchAll(TOKEN)].reduce<string[] | undefined>(
    (spellings: string[] | undefined, token: RegExpMatchArray): string[] | undefined => {
      const choices: string[] | undefined = tokenChoices(token);
      if (spellings === undefined || choices === undefined) return undefined;
      const next: string[] = product(spellings, choices);
      return next.length > MAX_SPELLINGS ? undefined : next;
    },
    [''],
  );

const isBlocked = (name: string): boolean =>
  BlockedOutputNameSchema.safeParse(name.toLowerCase()).success;

/** True when every name the basename can match is a blocked one. */
export const onlyMatchesBlocked = (basename: string): boolean => {
  const spellings: string[] | undefined = spellingsOf(basename);
  return spellings !== undefined && spellings.length > 0 && spellings.every(isBlocked);
};

const blockedList: string = BlockedOutputNameSchema.options.join(', ');

const suggestion = (stepName: string, entry: string): string => {
  const directory: string = path.posix.dirname(entry);
  const base: string = path.posix
    .basename(entry)
    .toLowerCase()
    .replace(/[[\]!^]/g, '');
  const prefixed: string = `${stepName}-${base}`;
  return directory === '.' ? prefixed : `${directory}/${prefixed}`;
};

const outputFindings =
  (report: Report) =>
  ([name, step]: [string, Step]): Finding[] =>
    (step.output ?? [])
      .filter((entry: string): boolean => onlyMatchesBlocked(path.posix.basename(entry)))
      .map((entry: string): Finding =>
        report.error(
          `steps.${name}.output: "${entry}" — a subagent's Write refuses the basenames ${blockedList} ` +
            `(any case; "Subagents should return findings as text"), so the step could not write it; ` +
            `use a prefixed name such as "${suggestion(name, entry)}"`,
        ),
      );

export const outputNameNotBlocked: PipelineRule = defineRule<PipelineContext>({
  id: 'output-name-not-blocked',
  description:
    'No step output is named summary.md, report.md, findings.md or analysis.md (any case): a subagent cannot write those.',
})(({ pipeline }, report) => stepEntries(pipeline).flatMap(outputFindings(report)));
