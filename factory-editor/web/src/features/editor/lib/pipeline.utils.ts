import type { Pipeline, PipelineEdge, PipelineStep } from './pipeline.types';
import { END } from './pipeline.types';

/** The text of a multi-line field (`prompt`, `system`): its lines joined with "\n". */
export const joinLines = (lines: readonly string[] | undefined): string => (lines ?? []).join('\n');

/** The lines a multi-line field stores for `text`: split on "\n". */
export const splitLines = (text: string): string[] => text.split('\n');

/** Insertion order of `steps` is the ordinal a step's output folder uses. */
export const stepNames = (pipeline: Pipeline): string[] => Object.keys(pipeline.steps);

export const ordinalOf = (pipeline: Pipeline, name: string): number =>
  stepNames(pipeline).indexOf(name) + 1;

const renameInList = (list: string[] | undefined, from: string, to: string): string[] =>
  (list ?? []).map((entry: string): string => (entry === from ? to : entry));

const withoutInList = (list: string[] | undefined, name: string): string[] =>
  (list ?? []).filter((entry: string): boolean => entry !== name);

/** Rebuild `steps` with the same key order, applying `fn` to each entry. */
const mapSteps = (
  pipeline: Pipeline,
  fn: (name: string, step: PipelineStep) => [string, PipelineStep] | null,
): Record<string, PipelineStep> =>
  Object.fromEntries(
    Object.entries(pipeline.steps)
      .map(([name, step]: [string, PipelineStep]) => fn(name, step))
      .filter((entry): entry is [string, PipelineStep] => entry !== null),
  );

const renameInEdges = (
  transitions: Record<string, PipelineEdge>,
  from: string,
  to: string,
): Record<string, PipelineEdge> =>
  Object.fromEntries(
    Object.entries(transitions).map(
      ([event, edge]: [string, PipelineEdge]): [string, PipelineEdge] => [
        event,
        {
          ...edge,
          target: renameInList(edge.target, from, to),
          ...(edge.onMax ? { onMax: renameInList(edge.onMax, from, to) } : {}),
        },
      ],
    ),
  );

/** Drop every reference to a step, and any edge left with no targets at all. */
const dropFromEdges = (
  transitions: Record<string, PipelineEdge>,
  name: string,
): Record<string, PipelineEdge> =>
  Object.fromEntries(
    Object.entries(transitions)
      .map(([event, edge]: [string, PipelineEdge]): [string, PipelineEdge] => {
        const onMax: string[] = withoutInList(edge.onMax, name);
        const next: PipelineEdge = { ...edge, target: withoutInList(edge.target, name) };
        delete next.onMax;
        return [event, onMax.length > 0 ? { ...next, onMax } : next];
      })
      .filter(([, edge]: [string, PipelineEdge]): boolean => edge.target.length > 0),
  );

export const renameStep = (pipeline: Pipeline, from: string, to: string): Pipeline => {
  if (from === to || !pipeline.steps[from] || pipeline.steps[to]) return pipeline;
  return {
    ...pipeline,
    START: renameInList(pipeline.START, from, to),
    steps: mapSteps(pipeline, (name: string, step: PipelineStep) => [
      name === from ? to : name,
      { ...step, transitions: renameInEdges(step.transitions, from, to) },
    ]),
  };
};

export const updateStep = (
  pipeline: Pipeline,
  name: string,
  patch: Partial<PipelineStep>,
): Pipeline => {
  const current: PipelineStep | undefined = pipeline.steps[name];
  if (!current) return pipeline;
  return {
    ...pipeline,
    steps: mapSteps(pipeline, (key: string, step: PipelineStep) => [
      key,
      key === name ? { ...step, ...patch } : step,
    ]),
  };
};

export const addStep = (pipeline: Pipeline, name: string): Pipeline => {
  if (pipeline.steps[name]) return pipeline;
  const ordinal: number = stepNames(pipeline).length + 1;
  const step: PipelineStep = {
    agent: 'general-purpose',
    prompt: [`Describe what ${name} does. Return DONE as the last line.`],
    input: [],
    output: [`${ordinal}-${name}/output.md`],
    transitions: { DONE: { target: [END] } },
  };
  return { ...pipeline, steps: { ...pipeline.steps, [name]: step } };
};

export const deleteStep = (pipeline: Pipeline, name: string): Pipeline => {
  if (!pipeline.steps[name]) return pipeline;
  return {
    ...pipeline,
    START: withoutInList(pipeline.START, name),
    steps: mapSteps(pipeline, (key: string, step: PipelineStep) =>
      key === name ? null : [key, { ...step, transitions: dropFromEdges(step.transitions, name) }],
    ),
  };
};

/** Add `target` to `source`'s edge for `event`, creating the event if new. */
export const connectStep = (
  pipeline: Pipeline,
  source: string,
  event: string,
  target: string,
): Pipeline => {
  const step: PipelineStep | undefined = pipeline.steps[source];
  if (!step) return pipeline;
  const existing: PipelineEdge | undefined = step.transitions[event];
  if (existing?.target.includes(target)) return pipeline;
  const edge: PipelineEdge = existing
    ? { ...existing, target: [...existing.target, target] }
    : { target: [target] };
  return updateStep(pipeline, source, { transitions: { ...step.transitions, [event]: edge } });
};

/** A free event name for a new connection out of `source`. */
export const nextEventName = (pipeline: Pipeline, source: string): string => {
  const taken: string[] = Object.keys(pipeline.steps[source]?.transitions ?? {});
  if (!taken.includes('DONE')) return 'DONE';
  for (let n = 2; n < 100; n += 1) {
    const candidate = `EVENT_${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return 'EVENT';
};

export const updateEdge = (
  pipeline: Pipeline,
  source: string,
  event: string,
  patch: Partial<PipelineEdge>,
): Pipeline => {
  const step: PipelineStep | undefined = pipeline.steps[source];
  const edge: PipelineEdge | undefined = step?.transitions[event];
  if (!step || !edge) return pipeline;
  const merged: PipelineEdge = { ...edge, ...patch };
  if (merged.max === undefined) delete merged.max;
  if (merged.onMax === undefined || merged.onMax.length === 0) delete merged.onMax;
  if (merged.condition === undefined || merged.condition.trim() === '') delete merged.condition;
  return updateStep(pipeline, source, { transitions: { ...step.transitions, [event]: merged } });
};

export const renameEvent = (
  pipeline: Pipeline,
  source: string,
  from: string,
  to: string,
): Pipeline => {
  const step: PipelineStep | undefined = pipeline.steps[source];
  if (!step || from === to || !step.transitions[from] || step.transitions[to]) return pipeline;
  const transitions: Record<string, PipelineEdge> = Object.fromEntries(
    Object.entries(step.transitions).map(
      ([event, edge]: [string, PipelineEdge]): [string, PipelineEdge] => [
        event === from ? to : event,
        edge,
      ],
    ),
  );
  return updateStep(pipeline, source, { transitions });
};

export const deleteEvent = (pipeline: Pipeline, source: string, event: string): Pipeline => {
  const step: PipelineStep | undefined = pipeline.steps[source];
  if (!step || !step.transitions[event]) return pipeline;
  const transitions: Record<string, PipelineEdge> = Object.fromEntries(
    Object.entries(step.transitions).filter(
      ([key]: [string, PipelineEdge]): boolean => key !== event,
    ),
  );
  return updateStep(pipeline, source, { transitions });
};

/** Remove one target from one event; drop the event when it was the last one. */
export const disconnect = (
  pipeline: Pipeline,
  source: string,
  event: string,
  target: string,
  isFallback: boolean,
): Pipeline => {
  const edge: PipelineEdge | undefined = pipeline.steps[source]?.transitions[event];
  if (!edge) return pipeline;
  if (isFallback) {
    const onMax: string[] = withoutInList(edge.onMax, target);
    return updateEdge(pipeline, source, event, { onMax: onMax.length > 0 ? onMax : undefined });
  }
  const target_: string[] = withoutInList(edge.target, target);
  return target_.length > 0
    ? updateEdge(pipeline, source, event, { target: target_ })
    : deleteEvent(pipeline, source, event);
};

export const setStart = (pipeline: Pipeline, start: string[]): Pipeline => ({
  ...pipeline,
  START: start,
});

// ------------------------------------------------------------- serialisation

const compact = <T>(entries: [string, T | undefined][]): Record<string, T> =>
  Object.fromEntries(
    entries.filter((entry): entry is [string, T] => entry[1] !== undefined),
  ) as Record<string, T>;

const serialiseEdge = (edge: PipelineEdge): Record<string, unknown> =>
  compact<unknown>([
    ['target', edge.target],
    ['max', edge.max],
    ['onMax', edge.onMax],
    ['condition', edge.condition],
  ]);

/** Order `fields` as the file had them; keys the file lacked follow in `defaults` order. */
const inFileOrder = (
  fields: Record<string, unknown>,
  keyOrder: string[] | undefined,
  defaults: readonly string[],
): Record<string, unknown> => {
  const known: string[] = (keyOrder ?? []).filter(
    (key: string): boolean => fields[key] !== undefined,
  );
  const rest: string[] = defaults.filter(
    (key: string): boolean => fields[key] !== undefined && !known.includes(key),
  );
  return Object.fromEntries(
    [...known, ...rest].map((key: string): [string, unknown] => [key, fields[key]]),
  );
};

const DEFAULT_STEP_KEY_ORDER: readonly string[] = [
  'agent',
  'system',
  'prompt',
  'knowledge',
  'workDir',
  'input',
  'output',
  'transitions',
];

const serialiseStep = (step: PipelineStep): Record<string, unknown> =>
  inFileOrder(
    compact<unknown>([
      ...Object.entries(step.extras ?? {}),
      ['agent', step.agent],
      ['system', step.system],
      ['prompt', step.prompt],
      ['knowledge', step.knowledge && step.knowledge.length > 0 ? step.knowledge : undefined],
      ['workDir', step.workDir],
      ['input', step.input],
      ['output', step.output],
      [
        'transitions',
        Object.fromEntries(
          Object.entries(step.transitions).map(
            ([event, edge]: [string, PipelineEdge]): [string, Record<string, unknown>] => [
              event,
              serialiseEdge(edge),
            ],
          ),
        ),
      ],
    ]),
    step.keyOrder,
    [...DEFAULT_STEP_KEY_ORDER, ...Object.keys(step.extras ?? {})],
  );

const DEFAULT_KEY_ORDER: readonly string[] = [
  '$schema',
  'id',
  'description',
  'constants',
  'params',
  'outputDir',
  'START',
  'steps',
];

/**
 * Emit the pipeline in the key order its file had — `keyOrder` — so an export
 * of an unchanged pipeline diffs clean against the original. Keys the file did
 * not have (a description added in the editor) follow in the default order, and
 * keys the editor does not model (`extras`, such as a top-level `hooks`) go where
 * the file had them — or last, for a pipeline built here.
 */
export const serialisePipeline = (pipeline: Pipeline): string =>
  `${JSON.stringify(
    inFileOrder(
      compact<unknown>([
        ...Object.entries(pipeline.extras ?? {}),
        ['$schema', pipeline.$schema],
        ['id', pipeline.id],
        ['description', pipeline.description],
        ['constants', pipeline.constants],
        ['params', pipeline.params],
        ['outputDir', pipeline.outputDir],
        ['START', pipeline.START],
        [
          'steps',
          Object.fromEntries(
            Object.entries(pipeline.steps).map(
              ([name, step]: [string, PipelineStep]): [string, Record<string, unknown>] => [
                name,
                serialiseStep(step),
              ],
            ),
          ),
        ],
      ]),
      pipeline.keyOrder,
      [...DEFAULT_KEY_ORDER, ...Object.keys(pipeline.extras ?? {})],
    ),
    null,
    2,
  )}\n`;

// -------------------------------------------------------------- editing

const OUTPUT_PREFIX_RE = /^\d+-[a-z0-9-]+\//;

/** A name not yet taken: `name`, else `name-2`, `name-3`… */
export const freeName = (pipeline: Pipeline, base: string): string => {
  if (!pipeline.steps[base]) return base;
  for (let n = 2; n < 1000; n += 1) {
    if (!pipeline.steps[`${base}-${n}`]) return `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
};

/**
 * Copy a step in right after the original, with its own output folder and
 * no incoming edges — it hangs off nothing until it is wired. Its outgoing
 * edges are kept, so the copy leads where the original did.
 */
export const duplicateStep = (pipeline: Pipeline, name: string): [Pipeline, string] => {
  const step: PipelineStep | undefined = pipeline.steps[name];
  if (!step) return [pipeline, name];
  const copy: string = freeName(pipeline, `${name}-copy`);
  const ordinal: number = ordinalOf(pipeline, name) + 1;
  const entries: [string, PipelineStep][] = Object.entries(pipeline.steps).flatMap(
    ([key, value]: [string, PipelineStep]): [string, PipelineStep][] =>
      key === name
        ? [
            [key, value],
            [
              copy,
              {
                ...value,
                output: (value.output ?? []).map((path: string): string =>
                  path.replace(OUTPUT_PREFIX_RE, `${ordinal}-${copy}/`),
                ),
                keyOrder: undefined,
              },
            ],
          ]
        : [[key, value]],
  );
  return [{ ...pipeline, steps: Object.fromEntries(entries) }, copy];
};

/** Insert a fresh step after `after` (or at the end), already wired from `source` on `event`. */
export const insertStep = (
  pipeline: Pipeline,
  name: string,
  source: string | null,
  event: string,
): Pipeline => {
  if (pipeline.steps[name]) return pipeline;
  const ordinal: number = stepNames(pipeline).length + 1;
  const step: PipelineStep = {
    agent: 'general-purpose',
    prompt: [`Describe what ${name} does. Return DONE as the last line.`],
    input: [],
    output: [`${ordinal}-${name}/output.md`],
    transitions: { DONE: { target: [END] } },
  };
  const withStep: Pipeline = { ...pipeline, steps: { ...pipeline.steps, [name]: step } };
  if (source === null) return withStep;
  return connectStep(withStep, source, event, name);
};

/**
 * Move one end of an edge. The event stays the same; the edge leaves the old
 * target (and the old source, when the source end was dragged) and joins the
 * new one.
 */
export const moveEdge = (
  pipeline: Pipeline,
  source: string,
  event: string,
  target: string,
  isFallback: boolean,
  nextSource: string,
  nextTarget: string,
): Pipeline => {
  if (nextSource === source && nextTarget === target) return pipeline;
  const edge: PipelineEdge | undefined = pipeline.steps[source]?.transitions[event];
  if (!edge) return pipeline;
  const removed: Pipeline = disconnect(pipeline, source, event, target, isFallback);
  if (isFallback) {
    const at: PipelineEdge | undefined = removed.steps[nextSource]?.transitions[event];
    if (!at) return pipeline;
    return updateEdge(removed, nextSource, event, {
      onMax: [...(at.onMax ?? []), nextTarget],
      max: at.max ?? edge.max,
    });
  }
  const joined: Pipeline = connectStep(removed, nextSource, event, nextTarget);
  // a moved edge keeps its cap and its condition
  return nextSource === source
    ? joined
    : updateEdge(joined, nextSource, event, { max: edge.max, condition: edge.condition });
};
