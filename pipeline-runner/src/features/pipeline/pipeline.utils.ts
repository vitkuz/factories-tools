import path from 'node:path';
import type { Scalar, Variables } from './pipeline.types.js';

export const ANCHOR_NAMES: readonly string[] = ['rootPath', 'skillPath', 'homePath'];
export const BUILTIN_NAMES: readonly string[] = ['id', 'slug', 'date', 'outputDir'];

const PLACEHOLDER: RegExp = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const GLOB_CHARS: RegExp = /[*?[\]{}]/;

// --- text ----------------------------------------------------------------------------------

/** The names inside every `{{name}}` of a text, in order of appearance, duplicates kept. */
export const placeholdersIn = (text: string): string[] =>
  [...text.matchAll(PLACEHOLDER)].map((match: RegExpMatchArray): string => match[1] ?? '');

/**
 * One pass, no recursion: `variables` is already fully expanded, so a value that happens to
 * contain `{{...}}` (a param the user typed) stays text. An unknown name is left as written.
 */
export const substitute =
  (variables: Variables) =>
  (text: string): string =>
    text.replace(PLACEHOLDER, (whole: string, name: string): string => variables[name] ?? whole);

/** `prompt` and `system` are written as lines so they stay readable in JSON; the text is the lines joined. */
export const joinLines = (lines: readonly string[]): string => lines.join('\n');

/** `How to Build an AI Dark Factory` → `how-to-build-an-ai-dark-factory`. Any script, not only Latin. */
export const slugify = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

/** Local calendar date, `YYYY-MM-DD` — the day the person running it is living in. */
export const formatDate = (date: Date): string => {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// --- paths ---------------------------------------------------------------------------------

export const isGlob = (text: string): boolean => GLOB_CHARS.test(text);

/** `<root>/.claude/skills/<id>`: the factory's wrapper skill folder, what `{{skillPath}}` stands for. */
export const wrapperSkillPath =
  (rootPath: string) =>
  (id: string): string =>
    path.join(rootPath, '.claude', 'skills', id);

/** A relative path hangs off `base`; an absolute one is only normalised. */
export const toAbsolute =
  (base: string) =>
  (target: string): string =>
    path.isAbsolute(target) ? path.normalize(target) : path.join(base, target);

// --- agents --------------------------------------------------------------------------------

/** Agents that need no profile on disk: the built-in one, and a person. */
const PROFILELESS_AGENTS: readonly string[] = ['general-purpose', 'human'];

export const isCustomAgent = (agent: string): boolean => !PROFILELESS_AGENTS.includes(agent);

// --- params --------------------------------------------------------------------------------

const TRUE_WORDS: readonly string[] = ['true', '1', 'yes'];
const FALSE_WORDS: readonly string[] = ['false', '0', 'no'];

export type Coerced = { ok: true; value: Scalar } | { ok: false; reason: string };

/** A supplied argument is text; it takes the type of the default it replaces. */
export const coerceToDefault =
  (fallback: Scalar) =>
  (supplied: string): Coerced => {
    if (typeof fallback === 'boolean') {
      const word = supplied.trim().toLowerCase();
      if (TRUE_WORDS.includes(word)) return { ok: true, value: true };
      if (FALSE_WORDS.includes(word)) return { ok: true, value: false };
      return { ok: false, reason: `${JSON.stringify(supplied)} is not a boolean` };
    }
    if (typeof fallback === 'number') {
      const parsed = Number(supplied);
      return supplied.trim() === '' || Number.isNaN(parsed)
        ? { ok: false, reason: `${JSON.stringify(supplied)} is not a number` }
        : { ok: true, value: parsed };
    }
    return { ok: true, value: supplied };
  };

// --- variables -----------------------------------------------------------------------------

export interface Expansion {
  variables: Record<string, string>;
  /** `a -> b -> a` for every reference cycle found. */
  cycles: string[];
}

/**
 * Expand `{{name}}` references between variables until none is left. Names in `literals` are
 * data, never templates: anchors, built-ins and whatever the user typed as a param.
 */
export const expandVariables = (
  raw: Readonly<Record<string, string>>,
  literals: ReadonlySet<string>,
): Expansion => {
  const cycles: string[] = [];

  const expand = (name: string, trail: readonly string[]): string => {
    const value: string | undefined = raw[name];
    if (value === undefined) return `{{${name}}}`;
    if (literals.has(name)) return value;
    if (trail.includes(name)) {
      cycles.push([...trail.slice(trail.indexOf(name)), name].join(' -> '));
      return `{{${name}}}`;
    }
    return value.replace(PLACEHOLDER, (_whole: string, inner: string): string =>
      expand(inner, [...trail, name]),
    );
  };

  const variables: Record<string, string> = Object.fromEntries(
    Object.keys(raw).map((name: string): [string, string] => [name, expand(name, [])]),
  );
  return { variables, cycles: [...new Set(cycles)] };
};
