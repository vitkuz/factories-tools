// A JSON Schema (draft 2020-12 subset) validator for tests: checks the runner's state.json
// against a factory's state.schema.json. Copied from the build-docs-site-factory tooling.

import fs from 'node:fs';
// Schema keywords carrying documentation rather than constraints.
const ANNOTATIONS = new Set([
  '$schema', '$id', 'title', 'description', 'examples', 'default',
  '$comment', 'format', 'deprecated', 'readOnly', 'writeOnly',
]);

const IMPLEMENTED = new Set([
  '$ref', '$defs', 'type', 'const', 'enum', 'pattern', 'minLength',
  'minimum', 'maximum', 'minItems', 'items', 'required', 'minProperties',
  'properties', 'propertyNames', 'additionalProperties',
  'dependentRequired', 'allOf', 'if', 'then', 'else',
]);


export const loadJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));


const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const kindOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
};

const typeMatches = (value, wanted) => {
  switch (wanted) {
    case 'object': return isObject(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'number': return typeof value === 'number';
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return true;
  }
};

const resolveRef = (ref, root) => {
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref (only local pointers): ${ref}`);
  return ref.slice(2).split('/').reduce(
    (node, raw) => node[raw.replace(/~1/g, '/').replace(/~0/g, '~')], root);
};

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Return a list of human-readable violations. Empty means valid. */
export const validateAgainstSchema = (value, schema, root = schema, where = '$') => {
  if (schema === true) return [];
  if (schema === false) return [`${where}: no value is allowed here`];
  if (!isObject(schema)) return [];
  if ('$ref' in schema) return validateAgainstSchema(value, resolveRef(schema.$ref, root), root, where);

  const errors = [];
  if (schema.type !== undefined) {
    const wanted = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!wanted.some((one) => typeMatches(value, one))) {
      // A wrong type makes every other keyword noise; stop here.
      return [`${where}: expected ${wanted.join(' or ')}, got ${kindOf(value)}`];
    }
  }
  if ('const' in schema && !deepEqual(value, schema.const)) {
    errors.push(`${where}: must be ${JSON.stringify(schema.const)}`);
  }
  if ('enum' in schema && !schema.enum.some((one) => deepEqual(one, value))) {
    errors.push(`${where}: ${JSON.stringify(value)} is not one of ${schema.enum.map((x) => JSON.stringify(x)).join(', ')}`);
  }
  if (typeof value === 'string') {
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${where}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
    }
    if ('minLength' in schema && value.length < schema.minLength) {
      errors.push(`${where}: must be at least ${schema.minLength} character(s)`);
    }
  }
  if (typeof value === 'number') {
    if ('minimum' in schema && value < schema.minimum) errors.push(`${where}: must be >= ${schema.minimum}`);
    if ('maximum' in schema && value > schema.maximum) errors.push(`${where}: must be <= ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if ('minItems' in schema && value.length < schema.minItems) {
      errors.push(`${where}: needs at least ${schema.minItems} item(s)`);
    }
    if (schema.items !== undefined) {
      value.forEach((entry, index) => {
        errors.push(...validateAgainstSchema(entry, schema.items, root, `${where}[${index}]`));
      });
    }
  }
  if (isObject(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${where}: missing required key ${JSON.stringify(key)}`);
    }
    if ('minProperties' in schema && Object.keys(value).length < schema.minProperties) {
      errors.push(`${where}: needs at least ${schema.minProperties} propert${schema.minProperties === 1 ? 'y' : 'ies'}`);
    }
    const properties = schema.properties ?? {};
    const additional = schema.additionalProperties ?? true;
    for (const [key, entry] of Object.entries(value)) {
      const child = `${where}.${key}`;
      if (schema.propertyNames !== undefined) {
        errors.push(...validateAgainstSchema(key, schema.propertyNames, root, `${where}: property name ${JSON.stringify(key)}`));
      }
      if (key in properties) {
        errors.push(...validateAgainstSchema(entry, properties[key], root, child));
      } else if (additional === false) {
        errors.push(`${where}: unexpected key ${JSON.stringify(key)}`);
      } else if (isObject(additional)) {
        errors.push(...validateAgainstSchema(entry, additional, root, child));
      }
    }
    for (const [key, needed] of Object.entries(schema.dependentRequired ?? {})) {
      if (key in value) {
        for (const name of needed) {
          if (!(name in value)) errors.push(`${where}: ${JSON.stringify(key)} also requires ${JSON.stringify(name)}`);
        }
      }
    }
  }
  for (const sub of schema.allOf ?? []) errors.push(...validateAgainstSchema(value, sub, root, where));
  if ('if' in schema) {
    if (validateAgainstSchema(value, schema.if, root, where).length === 0) {
      if ('then' in schema) errors.push(...validateAgainstSchema(value, schema.then, root, where));
    } else if ('else' in schema) {
      errors.push(...validateAgainstSchema(value, schema.else, root, where));
    }
  }
  const unknown = Object.keys(schema).filter((k) => !ANNOTATIONS.has(k) && !IMPLEMENTED.has(k)).sort();
  if (unknown.length) {
    errors.push(`${where}: schema uses keyword(s) this validator does not implement: ${unknown.join(', ')}`);
  }
  return errors;
};

