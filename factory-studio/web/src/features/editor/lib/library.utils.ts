import type {
  ImportResult,
  Pipeline,
  PipelineEdge,
  PipelineStep,
  Provenance,
  ProvenanceMap,
  Reference,
} from './pipeline.types';
import { END } from './pipeline.types';
import { freeName, joinLines, ordinalOf, stepNames } from './pipeline.utils';

/**
 * Building blocks. A step from a loaded reference pipeline is copied into the
 * open one: it gets a free name and its own output folder, the params and
 * constants its prompts use come along, and its events point at whatever was
 * already imported from the same reference — or at END until it is wired.
 * Nothing here touches the reference.
 */

const VAR_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const BUILTIN_VARS: readonly string[] = ['id', 'slug', 'date', 'outputDir'];
const OUTPUT_PREFIX_RE = /^(\d+)-([a-z0-9-]+)\//;

const unique = (values: string[]): string[] => [...new Set(values)];

/** Every `{{name}}` a step's text and paths mention. */
export const variablesOf = (step: PipelineStep): string[] =>
  unique(
    [
      joinLines(step.prompt),
      joinLines(step.system),
      step.workDir ?? '',
      ...(step.input ?? []),
      ...(step.output ?? []),
      ...(step.knowledge ?? []),
    ].flatMap((text: string): string[] =>
      [...text.matchAll(VAR_RE)].map((match: RegExpMatchArray): string => match[1]),
    ),
  ).filter((name: string): boolean => !BUILTIN_VARS.includes(name));

/** Add to `target` any param or constant of `source` that `step` uses and `target` lacks. */
export const carryVariables = (target: Pipeline, source: Pipeline, step: PipelineStep): Pipeline =>
  variablesOf(step).reduce((pipeline: Pipeline, name: string): Pipeline => {
    if (name in pipeline.params || name in pipeline.constants) return pipeline;
    if (name in source.constants) {
      return { ...pipeline, constants: { ...pipeline.constants, [name]: source.constants[name] } };
    }
    if (name in source.params) {
      return { ...pipeline, params: { ...pipeline.params, [name]: source.params[name] } };
    }
    return pipeline;
  }, target);

/** A reference key that is free in the library: the id, then `id-2`, `id-3`… */
export const referenceKey = (references: Reference[], id: string): string => {
  const taken: string[] = references.map((reference: Reference): string => reference.key);
  if (!taken.includes(id)) return id;
  for (let n = 2; n < 1000; n += 1) {
    if (!taken.includes(`${id}-${n}`)) return `${id}-${n}`;
  }
  return `${id}-${Date.now()}`;
};

/** The step in `pipeline` that was imported from `reference` as `original`, if it still exists. */
const importedAs = (
  pipeline: Pipeline,
  provenance: ProvenanceMap,
  reference: string,
  original: string,
): string | null =>
  Object.entries(provenance).find(
    ([name, from]: [string, Provenance]): boolean =>
      from.reference === reference &&
      from.original === original &&
      pipeline.steps[name] !== undefined,
  )?.[0] ?? null;

const rewritePrefix = (path: string, ordinal: number, name: string): string =>
  path.replace(OUTPUT_PREFIX_RE, `${ordinal}-${name}/`);

/**
 * An input path such as `2-scout-backend/report.md` names the folder of a step
 * in the reference. When that step has been imported too, point at its new
 * folder; otherwise leave it, and the Checks panel says nobody writes it.
 */
const rewriteInputs = (
  pipeline: Pipeline,
  provenance: ProvenanceMap,
  reference: string,
  inputs: string[] | undefined,
): string[] | undefined =>
  inputs?.map((path: string): string => {
    const match: RegExpMatchArray | null = path.match(OUTPUT_PREFIX_RE);
    if (!match) return path;
    const imported: string | null = importedAs(pipeline, provenance, reference, match[2]);
    return imported ? rewritePrefix(path, ordinalOf(pipeline, imported), imported) : path;
  });

const retarget = (
  targets: string[] | undefined,
  resolve: (original: string) => string | null,
): string[] =>
  unique(
    (targets ?? []).map((target: string): string =>
      target === END ? END : (resolve(target) ?? END),
    ),
  );

/**
 * Bring `original` from `reference` into `target`. Returns the pipeline, the
 * name the step got, and the provenance map with the new step recorded.
 */
export const importStep = (
  target: Pipeline,
  reference: Reference,
  original: string,
  provenance: ProvenanceMap,
): ImportResult => {
  const source: PipelineStep | undefined = reference.pipeline.steps[original];
  if (!source) return { pipeline: target, name: original, provenance };

  const name: string = freeName(target, original);
  const ordinal: number = stepNames(target).length + 1;
  const resolve = (candidate: string): string | null =>
    candidate === original ? name : importedAs(target, provenance, reference.key, candidate);

  const transitions: Record<string, PipelineEdge> = Object.fromEntries(
    Object.entries(source.transitions).map(
      ([event, edge]: [string, PipelineEdge]): [string, PipelineEdge] => {
        const onMax: string[] = retarget(edge.onMax, resolve);
        const next: PipelineEdge = {
          ...edge,
          target: retarget(edge.target, resolve),
          ...(edge.onMax ? { onMax } : {}),
        };
        return [event, next];
      },
    ),
  );

  const copied: PipelineStep = {
    ...source,
    output: source.output?.map((path: string): string => rewritePrefix(path, ordinal, name)),
    transitions,
    keyOrder: undefined,
  };

  const nextProvenance: ProvenanceMap = {
    ...provenance,
    [name]: { reference: reference.key, original },
  };
  const withStep: Pipeline = carryVariables(
    { ...target, steps: { ...target.steps, [name]: copied } },
    reference.pipeline,
    source,
  );

  // Earlier imports from the same reference pointed at this step by its old
  // name and were parked on END; now that it is here, point them at it.
  const relinked: Pipeline = {
    ...withStep,
    steps: Object.fromEntries(
      Object.entries(withStep.steps).map(
        ([existing, step]: [string, PipelineStep]): [string, PipelineStep] => {
          const from: Provenance | undefined = nextProvenance[existing];
          const originalStep: PipelineStep | undefined =
            from && from.reference === reference.key
              ? reference.pipeline.steps[from.original]
              : undefined;
          const input: string[] | undefined = originalStep
            ? rewriteInputs(withStep, nextProvenance, reference.key, step.input)
            : step.input;
          if (!originalStep || existing === name) {
            return [existing, { ...step, ...(input ? { input } : {}) }];
          }
          const relink = (
            current: string[] | undefined,
            originals: string[] | undefined,
          ): string[] | undefined => {
            if (!current || !originals?.includes(original)) return current;
            const parked: boolean =
              current.length === 1 && current[0] === END && !originals.includes(END);
            return parked ? [name] : unique([...current, name]);
          };
          return [
            existing,
            {
              ...step,
              ...(input ? { input } : {}),
              transitions: Object.fromEntries(
                Object.entries(step.transitions).map(
                  ([event, edge]: [string, PipelineEdge]): [string, PipelineEdge] => {
                    const originalEdge: PipelineEdge | undefined = originalStep.transitions[event];
                    const onMax: string[] | undefined = relink(edge.onMax, originalEdge?.onMax);
                    return [
                      event,
                      {
                        ...edge,
                        target: relink(edge.target, originalEdge?.target) ?? edge.target,
                        ...(onMax ? { onMax } : {}),
                      },
                    ];
                  },
                ),
              ),
            },
          ];
        },
      ),
    ),
  };

  return { pipeline: relinked, name, provenance: nextProvenance };
};

/** Every step of a reference, in order, edges between them kept. */
export const importAll = (
  target: Pipeline,
  reference: Reference,
  provenance: ProvenanceMap,
): ImportResult =>
  stepNames(reference.pipeline).reduce(
    (result: ImportResult, original: string): ImportResult => {
      const next: ImportResult = importStep(
        result.pipeline,
        reference,
        original,
        result.provenance,
      );
      return { ...next, name: result.name || next.name };
    },
    { pipeline: target, name: '', provenance },
  );
