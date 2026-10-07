// Learned from factories-tools/validation/src/features/pipeline/pipeline.utils.ts and
// factories-tools/run-state/src/features/pipeline/graph.utils.ts
import path from 'node:path';
import type { Edge, EdgeEntry, Pipeline, Scalar, Step, StringAt } from './pipeline.types.js';

export const END = 'END';
export const HUMAN_AGENT = 'human';
export const PIPELINE_FILE = 'pipeline.json';
/** The shared kit (a git submodule in every project). */
export const FACTORIES_DIR = 'factories';
/** The project's own factories, same layout; an id here shadows the shared one. */
export const LOCAL_FACTORIES_DIR = 'factories.local';
/** Where an id is looked up, in order. */
export const FACTORY_DIRS: readonly string[] = [LOCAL_FACTORIES_DIR, FACTORIES_DIR];
/** What a run writes and reads back across runs (insight stores, lessons): never inside the kit. */
export const FACTORY_DATA_DIR = 'factory-data';
export const SKILLS_DIR: string = path.join('.claude', 'skills');
export const SHARED_SCHEMA: string = path.join(FACTORIES_DIR, 'pipeline.schema.json');

/** Names every pipeline may use without declaring them. */
export const BUILT_INS: readonly string[] = ['id', 'slug', 'date', 'outputDir'];
/** The three path anchors every `constants` opens with, in this order. */
export const ANCHORS: readonly string[] = ['rootPath', 'skillPath', 'homePath'];

const PLACEHOLDER: RegExp = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

// --- where things live -----------------------------------------------------------------------

/** <root>/<dir>/<id>/pipeline.json */
export const pipelineFileIn =
  (dir: string) =>
  (rootPath: string) =>
  (id: string): string =>
    path.join(rootPath, dir, id, PIPELINE_FILE);

/** <root>/factories/<id>/pipeline.json: the shared place for an id. */
export const pipelineFileFor: (rootPath: string) => (id: string) => string =
  pipelineFileIn(FACTORIES_DIR);

/** <root>/factories.local/<id>/pipeline.json: the project's own place for an id. */
export const localPipelineFileFor: (rootPath: string) => (id: string) => string =
  pipelineFileIn(LOCAL_FACTORIES_DIR);

const isUnder =
  (folder: string) =>
  (file: string): boolean =>
    path.resolve(file).startsWith(path.resolve(folder) + path.sep);

/** The factory folder (`factories.local` or `factories`) a pipeline file sits in, if any. */
export const factoriesDirOf = (rootPath: string, file: string): string | undefined =>
  FACTORY_DIRS.find((dir: string): boolean => isUnder(path.join(rootPath, dir))(file));

/** True for a path under <root>/factory-data/: the project's own run data. */
export const isProjectData =
  (rootPath: string) =>
  (file: string): boolean =>
    isUnder(path.join(rootPath, FACTORY_DATA_DIR))(file);

/** <root>/.claude/skills/<id>: the factory's wrapper skill folder, what {{skillPath}} resolves to. */
export const wrapperSkillDirFor =
  (rootPath: string) =>
  (id: string): string =>
    path.join(rootPath, SKILLS_DIR, id);

export const sharedSchemaFor = (rootPath: string): string => path.join(rootPath, SHARED_SCHEMA);

// --- placeholders ----------------------------------------------------------------------------

/** The names inside every {{name}} of a text, in order, duplicates kept. */
export const placeholdersIn = (text: string): string[] =>
  [...text.matchAll(PLACEHOLDER)].map((match: RegExpMatchArray): string => match[1] ?? '');

export const hasPlaceholder = (text: string): boolean => placeholdersIn(text).length > 0;

export const hasGlob = (text: string): boolean => /[*?[]/.test(text);

/** Replace {{name}} from values, repeatedly, so constants may build on anchors. */
export const substitute =
  (values: Readonly<Record<string, Scalar>>) =>
  (text: string): string => {
    const once = (current: string): string =>
      current.replace(PLACEHOLDER, (whole: string, name: string): string =>
        name in values ? String(values[name]) : whole,
      );
    const settle = (current: string, rounds: number): string => {
      const next: string = once(current);
      return next === current || rounds <= 1 ? next : settle(next, rounds - 1);
    };
    return settle(text, 5);
  };

/**
 * What a path resolves against before a run: the constants, the built-in {{id}}, then the anchors —
 * {{rootPath}} the harness root, {{skillPath}} the wrapper skill folder, {{homePath}} the user's home.
 */
export const staticValues =
  (rootPath: string, homePath: string) =>
  (pipeline: Pipeline): Record<string, Scalar> => ({
    ...pipeline.constants,
    id: pipeline.id,
    rootPath,
    skillPath: wrapperSkillDirFor(rootPath)(pipeline.id),
    homePath,
  });

/** Every [jsonPath, string] in the document, the top-level $schema excluded. */
export const stringsIn = (node: unknown, where: string = 'pipeline'): StringAt[] => {
  if (typeof node === 'string') return [[where, node]];
  if (Array.isArray(node))
    return node.flatMap((value: unknown, index: number): StringAt[] =>
      stringsIn(value, `${where}[${index}]`),
    );
  if (node !== null && typeof node === 'object')
    return Object.entries(node).flatMap(([key, value]: [string, unknown]): StringAt[] =>
      where === 'pipeline' && key === '$schema' ? [] : stringsIn(value, `${where}.${key}`),
    );
  return [];
};

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

// --- graph -----------------------------------------------------------------------------------

/** All a graph walk needs of a pipeline: each step's transitions. A Pipeline and a ResolvedPipeline both fit. */
export type Graph = { steps: Readonly<Record<string, Pick<Step, 'transitions'>>> };

export const stepEntries = (pipeline: Pipeline): [string, Step][] => Object.entries(pipeline.steps);

export const edgesOf = (step: Pick<Step, 'transitions'> | undefined): EdgeEntry[] =>
  Object.entries(step?.transitions ?? {});

/** Every name an edge can route to: its target, plus its onMax escape. */
export const targetsOf = (edge: Edge): string[] => [...edge.target, ...(edge.onMax ?? [])];

export const isStep =
  (pipeline: Graph) =>
  (name: string): boolean =>
    Object.hasOwn(pipeline.steps, name);

/** The START names that are declared steps. */
export const declaredStarts = (pipeline: Pipeline): string[] =>
  pipeline.START.filter(isStep(pipeline));

/** Which names a step leads to. */
export type Neighbours = (pipeline: Graph) => (name: string) => string[];

/** Every edge: its target and its onMax escape. */
export const allNeighbours: Neighbours =
  (pipeline: Graph) =>
  (name: string): string[] =>
    edgesOf(pipeline.steps[name]).flatMap(([, edge]: EdgeEntry): string[] => targetsOf(edge));

/**
 * Forward edges only. Every loop closes through an edge with `max`, so dropping those leaves a graph
 * without cycles; onMax targets are exits, so they stay.
 */
export const forwardNeighbours: Neighbours =
  (pipeline: Graph) =>
  (name: string): string[] =>
    edgesOf(pipeline.steps[name]).flatMap(([, edge]: EdgeEntry): string[] => [
      ...(edge.max === undefined ? edge.target : []),
      ...(edge.onMax ?? []),
    ]);

/**
 * Every name reachable from `starts` (the starts themselves, and END when an edge points at it),
 * walking `next` and never past `stopAt`.
 */
export const reachableVia =
  (next: Neighbours) =>
  (pipeline: Graph) =>
  (starts: readonly string[], stopAt?: string): Set<string> => {
    const expand: (name: string) => string[] = next(pipeline);
    const walk = (queue: readonly string[], seen: ReadonlySet<string>): Set<string> => {
      const [head, ...rest]: readonly string[] = queue;
      if (head === undefined) return new Set(seen);
      if (seen.has(head)) return walk(rest, seen);
      const more: string[] =
        head !== END && head !== stopAt && isStep(pipeline)(head) ? expand(head) : [];
      return walk([...rest, ...more], new Set([...seen, head]));
    };
    return walk(starts, new Set());
  };

/** Every name reachable from starts by any edge — END included when an edge points at it. */
export const reachableFrom: (pipeline: Graph) => (starts: readonly string[]) => Set<string> =
  (pipeline: Graph) => (starts: readonly string[]) =>
    reachableVia(allNeighbours)(pipeline)(starts);

/** Layer of each step, breadth first from `starts` (a START step is 1); unreachable steps are absent. */
export const layersOf = (pipeline: Graph, starts: readonly string[]): Record<string, number> => {
  const next: (name: string) => string[] = allNeighbours(pipeline);
  const walk = (
    queue: readonly (readonly [string, number])[],
    layers: Readonly<Record<string, number>>,
  ): Record<string, number> => {
    const [head, ...rest]: readonly (readonly [string, number])[] = queue;
    if (head === undefined) return { ...layers };
    const [name, depth]: readonly [string, number] = head;
    if (name === END || Object.hasOwn(layers, name) || !isStep(pipeline)(name)) {
      return walk(rest, layers);
    }
    const more: (readonly [string, number])[] = next(name).map(
      (other: string): readonly [string, number] => [other, depth + 1],
    );
    return walk([...rest, ...more], { ...layers, [name]: depth });
  };
  return walk(
    starts.map((name: string): readonly [string, number] => [name, 1]),
    {},
  );
};
