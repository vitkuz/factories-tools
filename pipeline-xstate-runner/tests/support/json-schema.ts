// Learned from factories-tools/pipeline-runner/tests/support/json-schema.mjs: a JSON Schema (draft 2020-12
// subset) validator, enough for factories/state.schema.json and pipeline.schema.json.
import fs from 'node:fs';

type Json = unknown;
type Schema = Record<string, unknown> | boolean;

const ANNOTATIONS: ReadonlySet<string> = new Set([
  '$schema',
  '$id',
  'title',
  'description',
  'examples',
  'default',
  '$comment',
  'format',
  'deprecated',
  'readOnly',
  'writeOnly',
]);

const IMPLEMENTED: ReadonlySet<string> = new Set([
  '$ref',
  '$defs',
  'type',
  'const',
  'enum',
  'pattern',
  'minLength',
  'minimum',
  'maximum',
  'minItems',
  'items',
  'required',
  'minProperties',
  'properties',
  'propertyNames',
  'additionalProperties',
  'dependentRequired',
  'allOf',
  'if',
  'then',
  'else',
]);

export const loadJson = (file: string): Json => JSON.parse(fs.readFileSync(file, 'utf8'));

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const kindOf = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
};

const typeMatches = (value: unknown, wanted: string): boolean => {
  switch (wanted) {
    case 'object':
      return isObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true;
  }
};

const resolveRef = (ref: string, root: Record<string, unknown>): Schema => {
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref (only local pointers): ${ref}`);
  return ref
    .slice(2)
    .split('/')
    .reduce(
      (node: unknown, raw: string): unknown =>
        (node as Record<string, unknown>)[raw.replace(/~1/g, '/').replace(/~0/g, '~')],
      root,
    ) as Schema;
};

const deepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Every violation, in words. Empty means valid. */
export const validateAgainstSchema = (
  value: unknown,
  schema: Schema,
  root: Record<string, unknown> = schema as Record<string, unknown>,
  where: string = '$',
): string[] => {
  if (schema === true) return [];
  if (schema === false) return [`${where}: no value is allowed here`];
  if (!isObject(schema)) return [];
  if (typeof schema['$ref'] === 'string')
    return validateAgainstSchema(value, resolveRef(schema['$ref'], root), root, where);

  const errors: string[] = [];
  if (schema['type'] !== undefined) {
    const wanted: string[] = Array.isArray(schema['type'])
      ? (schema['type'] as string[])
      : [schema['type'] as string];
    if (!wanted.some((one: string): boolean => typeMatches(value, one))) {
      return [`${where}: expected ${wanted.join(' or ')}, got ${kindOf(value)}`];
    }
  }
  if ('const' in schema && !deepEqual(value, schema['const'])) {
    errors.push(`${where}: must be ${JSON.stringify(schema['const'])}`);
  }
  if (
    Array.isArray(schema['enum']) &&
    !schema['enum'].some((one: unknown): boolean => deepEqual(one, value))
  ) {
    errors.push(
      `${where}: ${JSON.stringify(value)} is not one of ${schema['enum'].map((x) => JSON.stringify(x)).join(', ')}`,
    );
  }
  if (typeof value === 'string') {
    if (typeof schema['pattern'] === 'string' && !new RegExp(schema['pattern']).test(value)) {
      errors.push(`${where}: ${JSON.stringify(value)} does not match ${schema['pattern']}`);
    }
    if (typeof schema['minLength'] === 'number' && value.length < schema['minLength']) {
      errors.push(`${where}: must be at least ${schema['minLength']} character(s)`);
    }
  }
  if (typeof value === 'number') {
    if (typeof schema['minimum'] === 'number' && value < schema['minimum'])
      errors.push(`${where}: must be >= ${schema['minimum']}`);
    if (typeof schema['maximum'] === 'number' && value > schema['maximum'])
      errors.push(`${where}: must be <= ${schema['maximum']}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema['minItems'] === 'number' && value.length < schema['minItems']) {
      errors.push(`${where}: needs at least ${schema['minItems']} item(s)`);
    }
    if (schema['items'] !== undefined) {
      value.forEach((entry: unknown, index: number): void => {
        errors.push(
          ...validateAgainstSchema(entry, schema['items'] as Schema, root, `${where}[${index}]`),
        );
      });
    }
  }
  if (isObject(value)) {
    for (const key of (schema['required'] as string[] | undefined) ?? []) {
      if (!(key in value)) errors.push(`${where}: missing required key ${JSON.stringify(key)}`);
    }
    if (
      typeof schema['minProperties'] === 'number' &&
      Object.keys(value).length < schema['minProperties']
    ) {
      errors.push(
        `${where}: needs at least ${schema['minProperties']} propert${schema['minProperties'] === 1 ? 'y' : 'ies'}`,
      );
    }
    const properties = (schema['properties'] as Record<string, Schema> | undefined) ?? {};
    const additional: unknown = schema['additionalProperties'] ?? true;
    for (const [key, entry] of Object.entries(value)) {
      const child = `${where}.${key}`;
      if (schema['propertyNames'] !== undefined) {
        errors.push(
          ...validateAgainstSchema(
            key,
            schema['propertyNames'] as Schema,
            root,
            `${where}: property name ${JSON.stringify(key)}`,
          ),
        );
      }
      if (key in properties) {
        errors.push(...validateAgainstSchema(entry, properties[key] as Schema, root, child));
      } else if (additional === false) {
        errors.push(`${where}: unexpected key ${JSON.stringify(key)}`);
      } else if (isObject(additional)) {
        errors.push(...validateAgainstSchema(entry, additional as Schema, root, child));
      }
    }
    for (const [key, needed] of Object.entries(
      (schema['dependentRequired'] as Record<string, string[]> | undefined) ?? {},
    )) {
      if (key in value) {
        for (const name of needed) {
          if (!(name in value))
            errors.push(`${where}: ${JSON.stringify(key)} also requires ${JSON.stringify(name)}`);
        }
      }
    }
  }
  for (const sub of (schema['allOf'] as Schema[] | undefined) ?? [])
    errors.push(...validateAgainstSchema(value, sub, root, where));
  if ('if' in schema) {
    if (validateAgainstSchema(value, schema['if'] as Schema, root, where).length === 0) {
      if ('then' in schema)
        errors.push(...validateAgainstSchema(value, schema['then'] as Schema, root, where));
    } else if ('else' in schema) {
      errors.push(...validateAgainstSchema(value, schema['else'] as Schema, root, where));
    }
  }
  const unknown: string[] = Object.keys(schema)
    .filter((k) => !ANNOTATIONS.has(k) && !IMPLEMENTED.has(k))
    .sort();
  if (unknown.length > 0) {
    errors.push(
      `${where}: schema uses keyword(s) this validator does not implement: ${unknown.join(', ')}`,
    );
  }
  return errors;
};
