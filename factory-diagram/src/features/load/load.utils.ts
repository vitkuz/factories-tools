import path from 'node:path';
import type { Scalar, ValidationOutcome, ValidatorReport, Variables } from './load.types.js';

export const PIPELINE_FILE = 'pipeline.json';
/** Factory graphs live at `<root>/factories/<id>/pipeline.json` (the shared kit); `.claude/skills/<id>/` only wraps them. */
export const FACTORIES_DIR = 'factories';
/** The project's own factories, same layout; an id here shadows the shared one. */
export const LOCAL_FACTORIES_DIR = 'factories.local';
/** Where an id is looked up, in order. */
export const FACTORY_DIRS: readonly string[] = [LOCAL_FACTORIES_DIR, FACTORIES_DIR];
/** The shared validator, bundled in factories-tools: plain node runs it, nothing to build. */
export const VALIDATOR_FILE: readonly string[] = ['factories-tools', 'bin', 'validate.mjs'];

export const ANCHOR_NAMES: readonly string[] = ['rootPath', 'skillPath', 'homePath'];

const PLACEHOLDER: RegExp = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

// --- locating ------------------------------------------------------------------------------

/**
 * Where `reference` may live, most literal reading first — the runner's order, with the path as
 * typed from the working directory ahead of it (the CLI is run from anywhere, the root is a flag).
 */
export const locateCandidates = (rootPath: string, reference: string, cwd: string): string[] => {
  const typed: string = path.resolve(cwd, reference);
  const direct: string = path.resolve(rootPath, reference);
  return [
    ...new Set([
      typed,
      path.join(typed, PIPELINE_FILE),
      direct,
      path.join(direct, PIPELINE_FILE),
      ...FACTORY_DIRS.flatMap((dir: string): string[] => [
        path.join(rootPath, dir, reference, PIPELINE_FILE),
        // a wrapper skill folder (`.claude/skills/<id>`) names the factory with the same id
        path.join(rootPath, dir, path.basename(direct), PIPELINE_FILE),
      ]),
    ]),
  ];
};

/** `<root>/.claude/skills/<id>`: the factory's wrapper skill folder, what `{{skillPath}}` stands for. */
export const wrapperSkillPath =
  (rootPath: string) =>
  (id: string): string =>
    path.join(rootPath, '.claude', 'skills', id);

export const validatorPath = (rootPath: string): string => path.join(rootPath, ...VALIDATOR_FILE);

/** True for `<root>/factories/<id>/pipeline.json` or `<root>/factories.local/<id>/pipeline.json` — a factory proper, not a fixture or a stray file. */
export const isInsideFactories = (rootPath: string, file: string): boolean =>
  FACTORY_DIRS.some((dir: string): boolean =>
    path.resolve(file).startsWith(path.join(path.resolve(rootPath), dir) + path.sep),
  );

// --- substitution (the runner's rules, minus what only a run knows) --------------------------

/** The names inside every `{{name}}` of a text, in order of appearance, duplicates kept. */
export const placeholdersIn = (text: string): string[] =>
  [...text.matchAll(PLACEHOLDER)].map((match: RegExpMatchArray): string => match[1] ?? '');

/** One pass: `variables` is already fully expanded. An unknown name is left as written. */
export const substitute =
  (variables: Variables) =>
  (text: string): string =>
    text.replace(PLACEHOLDER, (whole: string, name: string): string => variables[name] ?? whole);

export interface Expansion {
  variables: Record<string, string>;
  /** `a -> b -> a` for every reference cycle found. */
  cycles: string[];
}

/**
 * Expand `{{name}}` references between variables until none is left. Names in `literals` are
 * data, never templates: anchors, built-ins and param defaults.
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

export const asText = (values: Readonly<Record<string, Scalar>>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(values).map(([name, value]: [string, Scalar]): [string, string] => [
      name,
      String(value),
    ]),
  );

// --- legacy prompt shape (copied from the Studio's runs/lib/legacy.ts) ----------------------

/** A step written before prompts became line arrays: a string `prompt`, or a `systemPrompt`. */
export const isLegacyStep = (value: unknown): boolean => {
  const step = value as Record<string, unknown> | null;
  return (
    typeof step === 'object' &&
    step !== null &&
    (typeof step['prompt'] === 'string' || typeof step['systemPrompt'] === 'string')
  );
};

const toLines = (value: unknown): unknown =>
  typeof value === 'string' ? value.split('\n') : value;

/** One older step in the current shape: `prompt` as lines, `systemPrompt` as `system` lines. */
export const upgradeLegacyStep = (value: unknown): unknown => {
  if (!isLegacyStep(value)) return value;
  const { systemPrompt, ...step } = value as Record<string, unknown>;
  const system: unknown = toLines(step['system'] ?? systemPrompt);
  return {
    ...step,
    prompt: toLines(step['prompt']),
    ...(system === undefined ? {} : { system }),
  };
};

const stepsOf = (document: unknown): Record<string, unknown> => {
  const steps: unknown = (document as Record<string, unknown> | null)?.['steps'];
  return typeof steps === 'object' && steps !== null ? (steps as Record<string, unknown>) : {};
};

export const isLegacyPipeline = (document: unknown): boolean =>
  Object.values(stepsOf(document)).some(isLegacyStep);

/** The whole document in the current prompt shape; untouched when nothing in it is legacy. */
export const upgradeLegacyPipeline = (document: unknown): unknown => {
  if (!isLegacyPipeline(document)) return document;
  return {
    ...(document as Record<string, unknown>),
    steps: Object.fromEntries(
      Object.entries(stepsOf(document)).map(
        ([slug, step]: [string, unknown]): [string, unknown] => [slug, upgradeLegacyStep(step)],
      ),
    ),
  };
};

// --- what the validator's findings mean for a drawing -----------------------------------------

const UNREACHABLE: RegExp = /^steps\.([^.]+): not reachable from START$/;
const DANGLING_TARGET: RegExp =
  /^steps\.[^.]+\.transitions\.[^.]+\.(?:target|onMax): "([^"]+)" is not a step or END$/;
const DANGLING_START: RegExp = /^START: "([^"]+)" is not a step$/;
const END_UNREACHABLE: RegExp = /^END is not reachable from START/;
const NO_WRAPPER_SKILL: RegExp = /^no wrapper skill folder /;
/** The complaints the shared schema makes about a legacy prompt shape — the upgrade answers them. */
const LEGACY_SHAPE: readonly RegExp[] = [
  /^schema: pipeline\.steps\.[^.]+\.prompt: must be array, got string$/,
  /^schema: pipeline\.steps\.[^.]+\.system: must be array, got string$/,
  /^schema: pipeline\.steps\.[^.]+: unexpected key "systemPrompt"$/,
];

const firstGroup = (pattern: RegExp, text: string): string | undefined => pattern.exec(text)?.[1];

/**
 * The Studio draws what it can: a dangling target draws nothing for that edge, an unreachable
 * step still gets a column. Those validator errors become warnings here; every other error is
 * fatal — a graph that would not run is not drawn.
 */
export const classifyValidation = (
  report: ValidatorReport,
  legacy: boolean,
  insideFactories: boolean = true,
): ValidationOutcome => {
  const legacyShape: string[] = legacy
    ? report.errors.filter((e: string): boolean => LEGACY_SHAPE.some((p: RegExp) => p.test(e)))
    : [];
  const rest: string[] = report.errors.filter((e: string): boolean => !legacyShape.includes(e));
  const unreachable: string[] = rest.flatMap((e: string): string[] => {
    const slug: string | undefined = firstGroup(UNREACHABLE, e);
    return slug === undefined ? [] : [slug];
  });
  const dangling: string[] = rest.flatMap((e: string): string[] => {
    const name: string | undefined =
      firstGroup(DANGLING_TARGET, e) ?? firstGroup(DANGLING_START, e);
    return name === undefined ? [] : [name];
  });
  const isDangling = (e: string): boolean => DANGLING_TARGET.test(e) || DANGLING_START.test(e);
  const drawable = (e: string): boolean =>
    UNREACHABLE.test(e) || isDangling(e) || END_UNREACHABLE.test(e);
  return {
    fatal: rest.filter((e: string): boolean => !drawable(e)),
    // a dangling target is reported by the graph builder, naming the edge it drops
    warnings: [
      // a fixture or an ad-hoc file outside factories/ has no wrapper skill by design
      ...report.warnings.filter(
        (w: string): boolean => insideFactories || !NO_WRAPPER_SKILL.test(w),
      ),
      ...rest.filter((e: string): boolean => drawable(e) && !isDangling(e)),
      ...(legacyShape.length > 0
        ? ['legacy prompt shape (string prompt / systemPrompt) upgraded on read']
        : []),
    ],
    unreachable: [...new Set(unreachable)],
    dangling: [...new Set(dangling)],
  };
};
