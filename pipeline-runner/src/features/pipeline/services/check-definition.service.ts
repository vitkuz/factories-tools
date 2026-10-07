import { createAppError } from '../../../shared/utils/error.utils.js';
import { edgeTargets, reachableFrom, reachesEnd, successors } from '../graph.utils.js';
import { END } from '../pipeline.schema.js';
import type {
  EdgeDefinition,
  LoadedPipeline,
  PipelineDefinition,
  StepDefinition,
} from '../pipeline.types.js';
import { ANCHOR_NAMES, BUILTIN_NAMES, joinLines, placeholdersIn } from '../pipeline.utils.js';

/** A rule reads the definition and says what is wrong with it. No rule knows another exists. */
type Check = (definition: PipelineDefinition) => string[];

const unknownNames =
  (definition: PipelineDefinition) =>
  (where: string, names: readonly string[]): string[] =>
    names
      .filter((name: string): boolean => name !== END && !(name in definition.steps))
      .map(
        (name: string): string => `${where} names "${name}", which is not a step and is not END`,
      );

/** Every START, target and onMax names a declared step or END. */
const checkNames: Check = (definition: PipelineDefinition): string[] => {
  const unknown = unknownNames(definition);
  return [
    ...unknown('START', definition.START),
    ...Object.entries(definition.steps).flatMap(
      ([name, step]: [string, StepDefinition]): string[] =>
        Object.entries(step.transitions).flatMap(
          ([event, edge]: [string, EdgeDefinition]): string[] => [
            ...unknown(`${name}.transitions.${event}.target`, edge.target),
            ...unknown(`${name}.transitions.${event}.onMax`, edge.onMax ?? []),
          ],
        ),
    ),
  ];
};

/** Every step can be reached from START, and some path reaches END. */
const checkConnectivity: Check = (definition: PipelineDefinition): string[] => {
  const reachable: ReadonlySet<string> = reachableFrom(successors(definition.steps))(
    definition.START.filter((name: string): boolean => name in definition.steps),
  );
  return [
    ...Object.keys(definition.steps)
      .filter((name: string): boolean => !reachable.has(name))
      .map((name: string): string => `step "${name}" is unreachable from START`),
    ...(reachesEnd(definition.steps, definition.START)
      ? []
      : ['no edge anywhere reaches END, so the run can never finish']),
  ];
};

/** A human step's answer has to land in a file, or later steps cannot obey it. */
const checkHumanOutputs: Check = (definition: PipelineDefinition): string[] =>
  Object.entries(definition.steps)
    .filter(([, step]: [string, StepDefinition]): boolean => step.agent === 'human')
    .filter(([, step]: [string, StepDefinition]): boolean => step.output.length === 0)
    .map(([name]: [string, StepDefinition]): string => `human step "${name}" declares no output`);

/** A param or constant may not take the name of a built-in; a param may not shadow an anchor. */
const checkReservedNames: Check = (definition: PipelineDefinition): string[] => [
  ...Object.keys(definition.params)
    .filter((name: string): boolean => [...BUILTIN_NAMES, ...ANCHOR_NAMES].includes(name))
    .map((name: string): string => `param "${name}" takes a reserved name`),
  ...Object.keys(definition.constants)
    .filter((name: string): boolean => BUILTIN_NAMES.includes(name))
    .map((name: string): string => `constant "${name}" takes a reserved name`),
];

/** `[where, text]` for every string the runner substitutes. Conditions use bare names, not `{{}}`. */
const substitutedTexts = (definition: PipelineDefinition): [string, string][] => [
  ['outputDir', definition.outputDir],
  ...Object.entries(definition.constants).map(([name, value]): [string, string] => [
    `constants.${name}`,
    String(value),
  ]),
  ...definition.hooks.before.map((cmd: string, i: number): [string, string] => [
    `hooks.before[${i}]`,
    cmd,
  ]),
  ...definition.hooks.after.map((cmd: string, i: number): [string, string] => [
    `hooks.after[${i}]`,
    cmd,
  ]),
  ...Object.entries(definition.steps).flatMap(
    ([name, step]: [string, StepDefinition]): [string, string][] => [
      [`${name}.prompt`, joinLines(step.prompt)],
      [`${name}.system`, joinLines(step.system ?? [])],
      [`${name}.workDir`, step.workDir ?? ''],
      ...step.input.map((text: string, i: number): [string, string] => [
        `${name}.input[${i}]`,
        text,
      ]),
      ...step.output.map((text: string, i: number): [string, string] => [
        `${name}.output[${i}]`,
        text,
      ]),
      ...step.knowledge.map((text: string, i: number): [string, string] => [
        `${name}.knowledge[${i}]`,
        text,
      ]),
    ],
  ),
];

/** Every `{{name}}` is a param, a constant or a built-in. */
const checkPlaceholders: Check = (definition: PipelineDefinition): string[] => {
  const known: ReadonlySet<string> = new Set([
    ...BUILTIN_NAMES,
    ...Object.keys(definition.constants),
    ...Object.keys(definition.params),
  ]);
  return substitutedTexts(definition).flatMap(([where, text]: [string, string]): string[] =>
    [...new Set(placeholdersIn(text))]
      .filter((name: string): boolean => !known.has(name))
      .map(
        (name: string): string =>
          `${where} uses {{${name}}}, which is not a param, a constant or a built-in`,
      ),
  );
};

/** The routes nothing bounds: targets of edges with no `max`, and every `onMax` escape. */
const unboundedSuccessors =
  (definition: PipelineDefinition) =>
  (name: string): string[] =>
    Object.values(definition.steps[name]?.transitions ?? {})
      .flatMap((edge: EdgeDefinition): string[] =>
        edge.max === undefined ? edgeTargets(edge) : (edge.onMax ?? []),
      )
      .filter((target: string): boolean => target in definition.steps);

/**
 * A loop nothing bounds. A warning, not an error: a reviewer that never says the looping word
 * never takes it. The runner's own fuse (`maxStepPasses`) is what stops one that does.
 */
const checkLoopCaps: Check = (definition: PipelineDefinition): string[] => {
  const next = unboundedSuccessors(definition);
  return Object.keys(definition.steps)
    .filter((name: string): boolean => reachableFrom(next)(next(name)).has(name))
    .map((name: string): string => `step "${name}" sits on a loop that no "max" bounds`);
};

const ERROR_CHECKS: readonly Check[] = [
  checkNames,
  checkConnectivity,
  checkHumanOutputs,
  checkReservedNames,
  checkPlaceholders,
];

const WARNING_CHECKS: readonly Check[] = [checkLoopCaps];

const runChecks =
  (checks: readonly Check[]) =>
  (definition: PipelineDefinition): string[] =>
    checks.flatMap((check: Check): string[] => check(definition));

export const definitionIssues = runChecks(ERROR_CHECKS);
export const definitionWarnings = runChecks(WARNING_CHECKS);

/** Passes a sound pipeline on with its warnings attached; throws every issue at once on an unsound one. */
export const checkDefinition = (loaded: LoadedPipeline): LoadedPipeline => {
  const issues: string[] = definitionIssues(loaded.definition);
  if (issues.length > 0) {
    throw createAppError('PIPELINE_INVALID', `${loaded.file} is not a runnable graph`, issues);
  }
  return { ...loaded, warnings: definitionWarnings(loaded.definition) };
};
