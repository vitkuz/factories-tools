import { z } from 'zod';
import type { Pipeline, PipelineStep } from './pipeline.types';

const stepNameSchema = z.string().min(1);

const pipelineEdgeSchema = z.looseObject({
  target: z.array(stepNameSchema).min(1),
  max: z.number().int().min(1).optional(),
  onMax: z.array(stepNameSchema).min(1).optional(),
  condition: z.string().min(1).optional(),
});

const pipelineStepSchema = z.looseObject({
  agent: z.string().min(1),
  system: z.array(z.string()).optional(),
  prompt: z.array(z.string()),
  knowledge: z.array(z.string()).optional(),
  workDir: z.string().optional(),
  input: z.array(z.string()).optional(),
  output: z.array(z.string()).optional(),
  transitions: z.record(z.string(), pipelineEdgeSchema),
});

/**
 * Loose at every level: a key the editor does not model (a top-level `hooks`, a step's
 * `timeout`) passes through `parsePipeline` into `extras` and is written back untouched.
 */
export const pipelineSchema = z.looseObject({
  $schema: z.string().optional(),
  id: z.string().min(1),
  description: z.string().optional(),
  constants: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({
    rootPath: 'cwd',
    skillPath: '.',
    homePath: '~',
    factoryPath: '{{rootPath}}/factories/{{id}}',
  }),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  outputDir: z.string().min(1),
  START: z.array(stepNameSchema).min(1),
  steps: z.record(stepNameSchema, pipelineStepSchema),
});

export type PipelineDto = z.infer<typeof pipelineSchema>;

export interface ParseSuccess {
  ok: true;
  pipeline: Pipeline;
}

export interface ParseFailure {
  ok: false;
  message: string;
}

export type ParseResult = ParseSuccess | ParseFailure;

/** The keys the editor models; every other key of the file is an extra. */
export const MODELLED_KEYS: readonly string[] = [
  '$schema',
  'id',
  'description',
  'constants',
  'params',
  'outputDir',
  'START',
  'steps',
];

export const MODELLED_STEP_KEYS: readonly string[] = [
  'agent',
  'system',
  'prompt',
  'knowledge',
  'workDir',
  'input',
  'output',
  'transitions',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const keysOf = (value: unknown): string[] => (isRecord(value) ? Object.keys(value) : []);

/** The entries of `raw` whose key is not modelled; `undefined` when there are none. */
const extrasOf = (
  raw: unknown,
  modelled: readonly string[],
): Record<string, unknown> | undefined => {
  if (!isRecord(raw)) return undefined;
  const entries: [string, unknown][] = Object.entries(raw).filter(
    ([key]: [string, unknown]): boolean => !modelled.includes(key),
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

/** Only the modelled fields of a parsed step: zod's loose parse keeps unknown keys on the object. */
const modelledStep = (step: PipelineStep): PipelineStep =>
  Object.fromEntries(
    Object.entries(step).filter(([key]: [string, unknown]): boolean =>
      MODELLED_STEP_KEYS.includes(key),
    ),
  ) as PipelineStep;

const modelledPipeline = (pipeline: Pipeline): Pipeline =>
  Object.fromEntries(
    Object.entries(pipeline).filter(([key]: [string, unknown]): boolean =>
      MODELLED_KEYS.includes(key),
    ),
  ) as Pipeline;

/**
 * Remember the key order of the file, top level and per step, and capture the keys the
 * editor does not model, so an export of an unchanged pipeline is the file that was loaded.
 */
const withKeyOrder = (pipeline: Pipeline, raw: unknown): Pipeline => {
  const rawSteps: unknown = isRecord(raw) ? raw.steps : undefined;
  const extras: Record<string, unknown> | undefined = extrasOf(raw, MODELLED_KEYS);
  return {
    ...modelledPipeline(pipeline),
    keyOrder: keysOf(raw),
    ...(extras ? { extras } : {}),
    steps: Object.fromEntries(
      Object.entries(pipeline.steps).map(
        ([name, step]: [string, PipelineStep]): [string, PipelineStep] => {
          const rawStep: unknown = isRecord(rawSteps) ? rawSteps[name] : undefined;
          const stepExtras: Record<string, unknown> | undefined = extrasOf(
            rawStep,
            MODELLED_STEP_KEYS,
          );
          return [
            name,
            {
              ...modelledStep(step),
              keyOrder: keysOf(rawStep),
              ...(stepExtras ? { extras: stepExtras } : {}),
            },
          ];
        },
      ),
    ),
  };
};

/** Parse untrusted text (a file from the API, a dropped file, a paste) into a Pipeline. Never throws. */
export const parsePipeline = (text: string): ParseResult => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error: unknown) {
    return { ok: false, message: `not valid JSON: ${(error as Error).message}` };
  }

  const result = pipelineSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const where: string = first.path.join('.') || '<root>';
    return { ok: false, message: `${where}: ${first.message}` };
  }

  return { ok: true, pipeline: withKeyOrder(result.data as Pipeline, raw) };
};
