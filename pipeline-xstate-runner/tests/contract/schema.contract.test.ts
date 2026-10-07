/**
 * CONTRACT: the Zod twin of state.schema.json mirrors the kit's schema file (same keys, same
 * required keys, same enums), and pipeline.schema.ts mirrors pipeline.schema.json.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import type { z } from 'zod';
import {
  edgeSchema,
  pipelineSchema,
  stepSchema,
} from '../../src/features/pipeline/pipeline.schema.js';
import {
  HISTORY_TYPES,
  RUN_STATUSES,
  STEP_STATUSES,
  contextSchema,
  historyEntrySchema,
  pauseSchema,
  stateSchema,
  stepRecordSchema,
} from '../../src/features/state/state.schema.js';
import { FACTORIES_ROOT, describeWithKit, hasSiblingKit } from '../helpers.js';

interface JsonObjectSchema {
  required?: string[];
  additionalProperties?: unknown;
  properties: Record<string, { enum?: string[] } & JsonObjectSchema>;
}

const read = (file: string): JsonObjectSchema & { $defs: Record<string, JsonObjectSchema> } =>
  (hasSiblingKit()
    ? JSON.parse(readFileSync(path.join(FACTORIES_ROOT, file), 'utf8'))
    : { properties: {}, $defs: {} }) as JsonObjectSchema & {
    $defs: Record<string, JsonObjectSchema>;
  };

const keysOf = (shape: Record<string, z.ZodType>): { all: string[]; required: string[] } => ({
  all: Object.keys(shape).sort(),
  required: Object.entries(shape)
    .filter(([, field]) => !field.safeParse(undefined).success)
    .map(([key]) => key)
    .sort(),
});

const jsonKeysOf = (schema: JsonObjectSchema): { all: string[]; required: string[] } => ({
  all: Object.keys(schema.properties).sort(),
  required: [...(schema.required ?? [])].sort(),
});

describeWithKit('state.schema.ts mirrors factories/state.schema.json', () => {
  const json = read('state.schema.json');
  const stepRecord = json.$defs['stepRecord']!;
  const history = json.$defs['historyEvent']!;

  it.each([
    ['state', stateSchema.shape, json],
    ['context', contextSchema.shape, json.properties['context']!],
    ['pause', pauseSchema.shape, json.properties['pause']!],
    ['stepRecord', stepRecordSchema.shape, stepRecord],
    ['historyEvent', historyEntrySchema.shape, history],
  ] as const)('%s: same keys, same required keys, closed to others', (_name, shape, schema) => {
    expect(schema.additionalProperties).toBe(false);
    expect(keysOf(shape as Record<string, z.ZodType>)).toEqual(jsonKeysOf(schema));
  });

  it.each([
    ['run status', RUN_STATUSES, json.properties['status']!.enum],
    ['step status', STEP_STATUSES, stepRecord.properties['status']!.enum],
    ['history type', HISTORY_TYPES, history.properties['type']!.enum],
  ])('the same %s values', (_name, zod, jsonEnum) => {
    expect([...zod]).toEqual(jsonEnum);
  });
});

describeWithKit('pipeline.schema.ts mirrors factories/pipeline.schema.json', () => {
  const json = read('pipeline.schema.json');

  it('same top-level, step and edge keys', () => {
    expect(keysOf(pipelineSchema.shape)).toEqual(jsonKeysOf(json));
    expect(keysOf(stepSchema.shape)).toEqual(jsonKeysOf(json.$defs['step']!));
    expect(keysOf(edgeSchema.shape as Record<string, z.ZodType>)).toEqual(
      jsonKeysOf(json.$defs['edge']!),
    );
  });
});
