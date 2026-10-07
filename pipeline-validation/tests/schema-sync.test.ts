import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { z } from 'zod';
import {
  edgeSchema,
  hooksSchema,
  pipelineSchema,
  stepSchema,
} from '../src/features/pipeline/pipeline.schema.js';
import path from 'node:path';
import { FACTORIES_ROOT, describeWithKit, hasSiblingKit } from './kit.js';

/**
 * pipeline.schema.json (editor autocomplete) and pipeline.schema.ts (this validator) describe one
 * shape. This fails when a key is added, dropped or made required in one and not the other.
 */
interface JsonObjectSchema {
  required?: string[];
  properties: Record<string, unknown>;
}

const json = (
  hasSiblingKit()
    ? JSON.parse(readFileSync(path.join(FACTORIES_ROOT, 'pipeline.schema.json'), 'utf8'))
    : { properties: {}, $defs: {} }
) as JsonObjectSchema & {
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

describeWithKit('pipeline.schema.ts mirrors pipeline.schema.json', () => {
  it.each([
    ['pipeline', pipelineSchema.shape, json],
    ['step', stepSchema.shape, json.$defs['step']!],
    ['edge', edgeSchema.shape, json.$defs['edge']!],
    ['hooks', hooksSchema.shape, json.properties['hooks'] as JsonObjectSchema],
  ] as const)('%s: same keys, same required keys', (_name, shape, schema) => {
    expect(keysOf(shape as Record<string, z.ZodType>)).toEqual(jsonKeysOf(schema));
  });

  it('the same models', () => {
    const step = json.$defs['step']!.properties['model'] as { enum: string[] };
    expect(stepSchema.shape.model.unwrap().options).toEqual(step.enum);
  });
});
