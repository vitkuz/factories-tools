import type { Issue, Pipeline, PipelineEdge, PipelineStep, ScalarValue } from './pipeline.types';
import { END } from './pipeline.types';
import { joinLines, stepNames } from './pipeline.utils';

/**
 * A browser-side echo of the kit's validator CLI, `factories-tools/bin/validate.mjs` (and the shared
 * `pipeline.schema.json` beside it). It runs the same rules so the canvas can flag a broken
 * graph while you edit it — but that validator is still the gate `/any-factory` runs before
 * a pipeline executes, and it checks one thing this cannot: that every `knowledge` file
 * exists on disk.
 */

const BUILTIN_VARS: readonly string[] = ['id', 'slug', 'date', 'outputDir'];
/**
 * The three path anchors every pipeline opens its constants with, and the fixed value the
 * schema demands of each: the runner resolves `rootPath` to the harness working directory,
 * `skillPath` to the wrapper skill folder `.claude/skills/<id>` and `homePath` to the user's
 * home. Files of the factory itself are reached through `factoryPath`
 * (`{{rootPath}}/factories/{{id}}`), which pipelines declare right after them.
 */
const ANCHOR_VALUES: Readonly<Record<string, string>> = {
  rootPath: 'cwd',
  skillPath: '.',
  homePath: '~',
};
const REQUIRED_CONSTANTS: readonly string[] = Object.keys(ANCHOR_VALUES);
const FACTORY_PATH = 'factoryPath';
const CONDITION_KEYWORDS: readonly string[] = ['and', 'or', 'not', 'true', 'false'];
/** Constants may build on constants; this bounds the passes (and any cycle). */
const MAX_EXPANSIONS = 10;

const STEP_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EVENT_NAME_RE = /^[A-Z][A-Z0-9_]*$/;
const VAR_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const OUTPUT_DIR_RE = /^(\d+)-([a-z0-9-]+)\//;
const CONDITION_ALLOWED_RE = /^[A-Za-z0-9_\s."'><=!()&|+-]*$/;
const CONDITION_COMPARISON_RE = /(>=|<=|==|!=|>|<)/;
const CONDITION_IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/g;

const error = (where: string, message: string, subject?: string): Issue => ({
  level: 'error',
  where,
  message,
  subject,
});

const warning = (where: string, message: string, subject?: string): Issue => ({
  level: 'warning',
  where,
  message,
  subject,
});

const collectVars = (text: string | undefined): string[] => {
  if (!text) return [];
  return [...text.matchAll(VAR_RE)].map((match: RegExpMatchArray): string => match[1]);
};

const globToRegExp = (pattern: string): RegExp =>
  new RegExp(
    `^${pattern
      .split('')
      .map((char: string): string => {
        if (char === '*') return '[^/]*';
        if (char === '?') return '[^/]';
        return '\\^$.|+()[]{}'.includes(char) ? `\\${char}` : char;
      })
      .join('')}$`,
  );

/** Two paths overlap when either one, read as a glob, matches the other. */
const patternsOverlap = (a: string, b: string): boolean =>
  a === b || globToRegExp(a).test(b) || globToRegExp(b).test(a);

/** Every step reachable by following edges out of `from`. */
const reachableFrom = (from: string[], edges: Record<string, string[]>): Set<string> => {
  const seen = new Set<string>();
  const queue: string[] = [...from];
  while (queue.length > 0) {
    const name: string = queue.shift() as string;
    if (name === END || seen.has(name)) continue;
    seen.add(name);
    queue.push(...(edges[name] ?? []));
  }
  return seen;
};

/**
 * The back edges that close a loop, found with an iterative depth-first search
 * — the same walk `validate_pipeline.py` does, so both agree on which edge of a
 * cycle is the one that needs a cap.
 */
const findCycles = (edges: Record<string, string[]>): [string, string][] => {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color: Record<string, number> = Object.fromEntries(
    Object.keys(edges).map((node: string): [string, number] => [node, WHITE]),
  );
  const backEdges: [string, string][] = [];

  for (const root of Object.keys(edges)) {
    if (color[root] !== WHITE) continue;
    color[root] = GREY;
    const stack: { node: string; index: number }[] = [{ node: root, index: 0 }];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const children: string[] = edges[frame.node] ?? [];
      let advanced = false;

      while (frame.index < children.length) {
        const child: string = children[frame.index];
        frame.index += 1;
        if (child === END || color[child] === undefined) continue;
        if (color[child] === GREY) {
          backEdges.push([frame.node, child]);
        } else if (color[child] === WHITE) {
          color[child] = GREY;
          stack.push({ node: child, index: 0 });
          advanced = true;
          break;
        }
      }

      if (!advanced) {
        color[frame.node] = BLACK;
        stack.pop();
      }
    }
  }

  const seen = new Set<string>();
  return backEdges.filter(([source, target]: [string, string]): boolean => {
    const key = `${source}->${target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** name -> every target it can hand control to, `target` and `onMax` alike. */
export const buildAdjacency = (pipeline: Pipeline): Record<string, string[]> =>
  Object.fromEntries(
    Object.entries(pipeline.steps).map(
      ([name, step]: [string, PipelineStep]): [string, string[]] => [
        name,
        [
          ...new Set(
            Object.values(step.transitions).flatMap((edge: PipelineEdge): string[] => [
              ...edge.target,
              ...(edge.onMax ?? []),
            ]),
          ),
        ],
      ],
    ),
  );

/**
 * The shell commands in `hooks.before` / `hooks.after`. The editor does not model `hooks`,
 * so they ride in `extras` — but they are substituted like every other string.
 */
const hookCommands = (pipeline: Pipeline): [string, string][] => {
  const hooks: unknown = pipeline.extras?.hooks;
  if (typeof hooks !== 'object' || hooks === null) return [];
  return (['before', 'after'] as const).flatMap((phase): [string, string][] => {
    const commands: unknown = (hooks as Record<string, unknown>)[phase];
    return Array.isArray(commands)
      ? commands
          .filter((command: unknown): command is string => typeof command === 'string')
          .map((command: string): [string, string] => [`<root>.hooks.${phase}`, command])
      : [];
  });
};

/**
 * `{{name}}` for every constant that is not an anchor replaced by its value, pass after pass,
 * so `{{knowledgePath}}/x.md` with `knowledgePath: "{{factoryPath}}/knowledge"` ends up as
 * `{{factoryPath}}/knowledge/x.md`. The anchors, `factoryPath` and unknown names stay as
 * they are, so the result says where a path is rooted.
 */
const expandConstants = (text: string, constants: Record<string, ScalarValue>): string => {
  const expandOnce = (current: string): string =>
    current.replace(VAR_RE, (match: string, name: string): string =>
      name in constants && !(name in ANCHOR_VALUES) && name !== FACTORY_PATH
        ? String(constants[name])
        : match,
    );
  const step = (current: string, left: number): string => {
    const next: string = expandOnce(current);
    return next === current || left <= 1 ? next : step(next, left - 1);
  };
  return step(text, MAX_EXPANSIONS);
};

const checkTopLevel = (pipeline: Pipeline): Issue[] => {
  const issues: Issue[] = [];
  if (!STEP_NAME_RE.test(pipeline.id)) {
    issues.push(warning('<root>.id', `'${pipeline.id}' is not kebab-case`));
  }
  if (!pipeline.outputDir.trim()) {
    issues.push(error('<root>.outputDir', "'outputDir' is required"));
  } else if (pipeline.outputDir.includes('{{outputDir}}')) {
    issues.push(
      error(
        '<root>.outputDir',
        'outputDir cannot use {{outputDir}}: it is resolved from this value',
      ),
    );
  }
  for (const name of REQUIRED_CONSTANTS) {
    if (name in pipeline.params) {
      issues.push(error('<root>.params', `'${name}' belongs in constants, not params`));
    }
    const value: ScalarValue | undefined = pipeline.constants[name];
    if (value === undefined || String(value).trim() === '') {
      issues.push(error('<root>.constants', `'${name}' is required and is missing`));
    } else if (value !== ANCHOR_VALUES[name]) {
      issues.push(
        error(
          `<root>.constants.${name}`,
          `'${name}' must be "${ANCHOR_VALUES[name]}" — the runner resolves it; it is not a path to set`,
        ),
      );
    }
  }
  const order: string[] = Object.keys(pipeline.constants);
  if (REQUIRED_CONSTANTS.some((name: string, index: number): boolean => order[index] !== name)) {
    issues.push(
      warning(
        '<root>.constants',
        `constants should open with ${REQUIRED_CONSTANTS.join(', ')} in that order`,
      ),
    );
  }
  const factoryPath: ScalarValue | undefined = pipeline.constants[FACTORY_PATH];
  if (factoryPath === undefined) {
    issues.push(
      warning(
        '<root>.constants',
        `'${FACTORY_PATH}' is not declared — "{{rootPath}}/factories/{{id}}" is how a step reaches the factory's own files (knowledge, extras)`,
      ),
    );
  } else if (factoryPath !== '{{rootPath}}/factories/{{id}}') {
    issues.push(
      warning(
        `<root>.constants.${FACTORY_PATH}`,
        `'${factoryPath}' is not "{{rootPath}}/factories/{{id}}", where the graph lives`,
      ),
    );
  }
  if (pipeline.START.length === 0) {
    issues.push(error('<root>.START', 'START must name at least one step'));
  }
  for (const name of pipeline.START) {
    if (!pipeline.steps[name]) {
      issues.push(error('<root>.START', `'${name}' is not a step`));
    }
  }
  return issues;
};

// Every step lying on a cycle closed by the back edge source -> target: reachable
// from `target`, and able to reach `source` again.
const cycleMembers = (
  source: string,
  target: string,
  edges: Record<string, string[]>,
): Set<string> => {
  const forward: Set<string> = reachableFrom([target], edges);
  forward.add(target);
  return new Set<string>(
    [...forward].filter(
      (name: string): boolean => name === source || reachableFrom([name], edges).has(source),
    ),
  );
};

// True when any edge inside that cycle carries a `max`. The cap bounds the loop
// wherever it sits, so a graph that revises via `review -> plan` with `max: 2`
// is capped even though the edge closing the cycle carries none.
const cycleIsCapped = (
  pipeline: Pipeline,
  source: string,
  target: string,
  edges: Record<string, string[]>,
): boolean => {
  const members: Set<string> = cycleMembers(source, target, edges);
  return [...members].some((name: string): boolean =>
    Object.values(pipeline.steps[name]?.transitions ?? {}).some(
      (edge: PipelineEdge): boolean =>
        edge.max !== undefined && edge.target.some((t: string): boolean => members.has(t)),
    ),
  );
};

const checkStep = (
  pipeline: Pipeline,
  name: string,
  step: PipelineStep,
  ordinal: number,
): Issue[] => {
  const issues: Issue[] = [];
  const where = `steps.${name}`;

  if (!STEP_NAME_RE.test(name)) {
    issues.push(warning(where, `step name '${name}' is not kebab-case`, name));
  }
  if (!joinLines(step.prompt).trim()) {
    issues.push(error(`${where}.prompt`, "'prompt' is required and must be non-empty", name));
  }
  if (step.system !== undefined && !joinLines(step.system).trim()) {
    issues.push(warning(`${where}.system`, 'system is empty — drop the field', name));
  }

  for (const path of step.output ?? []) {
    const match: RegExpMatchArray | null = path.match(OUTPUT_DIR_RE);
    if (!match) {
      issues.push(
        warning(
          `${where}.output`,
          `'${path}' does not start with '{n}-{step-name}/' — expected '${ordinal}-${name}/...'`,
          name,
        ),
      );
    } else if (match[2] !== name) {
      issues.push(warning(`${where}.output`, `'${path}' writes into another step's folder`, name));
    }
  }

  const events: string[] = Object.keys(step.transitions);
  if (events.length === 0) {
    issues.push(error(`${where}.transitions`, "'transitions' needs at least one event", name));
  }

  let conditional = 0;
  for (const [event, edge] of Object.entries(step.transitions)) {
    const edgeWhere = `${where}.transitions.${event}`;
    if (!EVENT_NAME_RE.test(event)) {
      issues.push(warning(edgeWhere, `event '${event}' is not UPPER_SNAKE_CASE`, name));
    }
    if (edge.target.length === 0) {
      issues.push(error(edgeWhere, "'target' must name at least one step or END", name));
    }
    for (const target of edge.target) {
      if (target !== END && !pipeline.steps[target]) {
        issues.push(error(edgeWhere, `target '${target}' is not a step and is not END`, name));
      }
    }
    if (edge.max !== undefined && (!Number.isInteger(edge.max) || edge.max < 1)) {
      issues.push(error(`${edgeWhere}.max`, "'max' must be a whole number of 1 or more", name));
    }
    if (edge.onMax !== undefined) {
      if (edge.onMax.length === 0) {
        issues.push(error(`${edgeWhere}.onMax`, "'onMax' must name at least one target", name));
      }
      if (edge.max === undefined) {
        issues.push(warning(`${edgeWhere}.onMax`, "'onMax' has no 'max' to trigger it", name));
      }
      for (const target of edge.onMax) {
        if (target !== END && !pipeline.steps[target]) {
          issues.push(error(`${edgeWhere}.onMax`, `target '${target}' is not a step`, name));
        }
      }
    }
    if (edge.condition !== undefined) {
      conditional += 1;
      if (!CONDITION_ALLOWED_RE.test(edge.condition)) {
        issues.push(
          error(`${edgeWhere}.condition`, 'condition uses characters outside the grammar', name),
        );
      } else if (!CONDITION_COMPARISON_RE.test(edge.condition)) {
        issues.push(
          error(`${edgeWhere}.condition`, 'condition has no comparison, e.g. "findings > 1"', name),
        );
      }
    }
  }
  if (events.length > 0 && conditional === events.length) {
    issues.push(
      warning(
        `${where}.transitions`,
        'every edge is conditional, so the step may have no way out',
        name,
      ),
    );
  }

  if (step.agent === 'human') {
    for (const event of events) {
      if (!new RegExp(`\\b${event}\\b`).test(joinLines(step.prompt))) {
        issues.push(
          error(`${where}.prompt`, `the question never mentions the answer '${event}'`, name),
        );
      }
    }
    if ((step.output ?? []).length === 0) {
      issues.push(
        error(`${where}.output`, 'a human step needs an output file: its decision', name),
      );
    }
    if ((step.knowledge ?? []).length > 0) {
      issues.push(warning(`${where}.knowledge`, 'knowledge is ignored on a human step', name));
    }
    if (step.system !== undefined) {
      issues.push(warning(`${where}.system`, 'system is ignored on a human step', name));
    }
    if (step.extras?.model !== undefined) {
      issues.push(warning(`${where}.model`, 'model is ignored on a human step', name));
    }
  }

  issues.push(...checkKnowledgePaths(pipeline, name, step));

  return issues;
};

/**
 * Where a knowledge file lives. Every factory folder is self-contained: a knowledge file
 * sits under `{{factoryPath}}/knowledge/` (a bare relative path also resolves against the
 * factory folder), and a file another factory has is copied in, never pointed at. The gate
 * checks that the file exists; this checks that it is the factory's own.
 */
const checkKnowledgePaths = (pipeline: Pipeline, name: string, step: PipelineStep): Issue[] => {
  const issues: Issue[] = [];
  const where = `steps.${name}.knowledge`;
  for (const path of step.knowledge ?? []) {
    const expanded: string = expandConstants(path, pipeline.constants);
    if (expanded.startsWith(`{{${FACTORY_PATH}}}/`)) {
      if (!expanded.startsWith(`{{${FACTORY_PATH}}}/knowledge/`)) {
        issues.push(
          warning(
            where,
            `'${path}' is in the factory folder but not under {{${FACTORY_PATH}}}/knowledge/`,
            name,
          ),
        );
      }
      continue;
    }
    const outside: boolean =
      expanded.startsWith('/') ||
      REQUIRED_CONSTANTS.some((anchor: string): boolean => expanded.startsWith(`{{${anchor}}}/`));
    if (outside) {
      issues.push(
        warning(
          where,
          `'${path}' lives outside the factory folder — copy it under {{${FACTORY_PATH}}}/knowledge/ so the factory is self-contained`,
          name,
        ),
      );
    }
  }
  return issues;
};

const checkGraph = (pipeline: Pipeline, adjacency: Record<string, string[]>): Issue[] => {
  const issues: Issue[] = [];
  const names: string[] = stepNames(pipeline);
  const live: Set<string> = reachableFrom(pipeline.START, adjacency);

  for (const name of names) {
    if (!live.has(name)) {
      issues.push(error(`steps.${name}`, 'step is unreachable from START', name));
    }
  }

  const canEnd = new Set<string>(
    names.filter((name: string): boolean => (adjacency[name] ?? []).includes(END)),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of names) {
      if (canEnd.has(name)) continue;
      if ((adjacency[name] ?? []).some((target: string): boolean => canEnd.has(target))) {
        canEnd.add(name);
        changed = true;
      }
    }
  }
  if (canEnd.size === 0) {
    issues.push(error('<root>.steps', 'no step targets END, so the pipeline can never finish'));
  } else {
    for (const name of names) {
      if (live.has(name) && !canEnd.has(name)) {
        issues.push(error(`steps.${name}`, 'END is not reachable from this step', name));
      }
    }
  }

  // A loop is legal; an uncapped loop is not. Only the back edge that closes
  // the loop is reported, so a two-step cycle raises one warning, not two.
  // The cap may sit on any edge of the cycle -- typically the one that routes
  // back, not the one that closes the loop in traversal order.
  for (const [source, target] of findCycles(adjacency)) {
    const step: PipelineStep | undefined = pipeline.steps[source];
    if (!step) continue;
    const looping: string[] = Object.entries(step.transitions)
      .filter(([, edge]: [string, PipelineEdge]): boolean => edge.target.includes(target))
      .filter(([, edge]: [string, PipelineEdge]): boolean => edge.max === undefined)
      .map(([event]: [string, PipelineEdge]): string => event)
      .sort();
    if (looping.length > 0 && !cycleIsCapped(pipeline, source, target, adjacency)) {
      issues.push(
        warning(
          `steps.${source}.transitions.${looping[0]}`,
          `loop back to '${target}' on ${looping.join(', ')} with no 'max' to cap it`,
          source,
        ),
      );
    }
  }

  return issues;
};

const checkDataFlow = (pipeline: Pipeline, adjacency: Record<string, string[]>): Issue[] => {
  const issues: Issue[] = [];
  const names: string[] = stepNames(pipeline);

  const ancestors: Record<string, Set<string>> = Object.fromEntries(
    names.map((name: string): [string, Set<string>] => [name, new Set<string>()]),
  );
  for (const name of names) {
    for (const descendant of reachableFrom(adjacency[name] ?? [], adjacency)) {
      ancestors[descendant]?.add(name);
    }
  }

  const producedBy: Record<string, Set<string>> = {};
  for (const name of names) {
    for (const path of pipeline.steps[name].output ?? []) {
      producedBy[path] = producedBy[path] ?? new Set<string>();
      producedBy[path].add(name);
    }
  }

  const terminal = new Set<string>(
    names.filter((name: string): boolean => (adjacency[name] ?? []).includes(END)),
  );
  const consumed = new Set<string>();

  for (const name of names) {
    for (const path of pipeline.steps[name].input ?? []) {
      const matches: string[] = Object.keys(producedBy).filter((output: string): boolean =>
        patternsOverlap(path, output),
      );
      matches.forEach((output: string): void => void consumed.add(output));
      const producers: string[] = [
        ...new Set(matches.flatMap((output: string): string[] => [...producedBy[output]])),
      ];
      if (producers.length === 0) {
        issues.push(error(`steps.${name}.input`, `'${path}' is not written by any step`, name));
      } else if (!producers.some((producer: string): boolean => ancestors[name].has(producer))) {
        issues.push(
          error(
            `steps.${name}.input`,
            `'${path}' is only written by ${producers.join(', ')}, which cannot run before this step`,
            name,
          ),
        );
      }
    }
  }

  for (const [path, producers] of Object.entries(producedBy)) {
    const owner: string = [...producers].sort()[0];
    const isDeliverable: boolean = [...producers].some((name: string): boolean =>
      terminal.has(name),
    );
    if (!consumed.has(path) && !isDeliverable) {
      issues.push(
        warning(`steps.${owner}.output`, `'${path}' is never read by another step`, owner),
      );
    }
  }

  return issues;
};

const checkSubstitution = (pipeline: Pipeline): Issue[] => {
  const issues: Issue[] = [];
  const declared = new Set<string>([
    ...Object.keys(pipeline.params),
    ...Object.keys(pipeline.constants),
    ...BUILTIN_VARS,
  ]);
  const used = new Set<string>();

  for (const key of Object.keys(pipeline.params)) {
    if (key in pipeline.constants) {
      issues.push(warning('<root>.params', `'${key}' is declared in both params and constants`));
    }
  }

  const scan = (text: string | undefined, where: string, subject?: string): void => {
    for (const name of collectVars(text)) {
      used.add(name);
      if (!declared.has(name)) {
        issues.push(error(where, `{{${name}}} is not declared`, subject));
      }
    }
  };

  scan(pipeline.outputDir, '<root>.outputDir');
  // A constant built on another (`factoryPath` on `rootPath` and the built-in `id`,
  // `knowledgePath` on `factoryPath`) uses it: that is what keeps the anchors' names out of
  // the "never used" list below.
  for (const [name, value] of Object.entries(pipeline.constants)) {
    if (typeof value === 'string') scan(value, `<root>.constants.${name}`);
  }
  for (const [where, command] of hookCommands(pipeline)) {
    scan(command, where);
  }
  for (const [name, step] of Object.entries(pipeline.steps)) {
    scan(joinLines(step.prompt), `steps.${name}.prompt`, name);
    scan(step.system && joinLines(step.system), `steps.${name}.system`, name);
    scan(step.workDir, `steps.${name}.workDir`, name);
    for (const path of [...(step.input ?? []), ...(step.output ?? [])]) {
      scan(path, `steps.${name}.input/output`, name);
    }
    for (const path of step.knowledge ?? []) {
      scan(path, `steps.${name}.knowledge`, name);
    }
    for (const [event, edge] of Object.entries(step.transitions)) {
      if (edge.condition === undefined) continue;
      const bare: string = edge.condition.replace(/"[^"]*"|'[^']*'/g, ' ');
      for (const ident of bare.match(CONDITION_IDENT_RE) ?? []) {
        if (CONDITION_KEYWORDS.includes(ident.toLowerCase())) continue;
        if (declared.has(ident)) {
          used.add(ident);
          continue;
        }
        if (new RegExp(`\\b${ident}\\b`).test(joinLines(step.prompt))) continue;
        issues.push(
          warning(
            `steps.${name}.transitions.${event}.condition`,
            `'${ident}' is not a param, a constant, or named in the prompt`,
            name,
          ),
        );
      }
    }
  }

  // The anchors and `factoryPath` are standing declarations: every pipeline carries them,
  // used or not, so they are never "unused".
  for (const name of [...Object.keys(pipeline.params), ...Object.keys(pipeline.constants)]) {
    if (!used.has(name) && !REQUIRED_CONSTANTS.includes(name) && name !== FACTORY_PATH) {
      issues.push(
        warning('<root>', `'${name}' is declared but never used in a {{...}} placeholder`),
      );
    }
  }

  return issues;
};

export const validatePipeline = (pipeline: Pipeline): Issue[] => {
  const adjacency: Record<string, string[]> = buildAdjacency(pipeline);
  return [
    ...checkTopLevel(pipeline),
    ...stepNames(pipeline).flatMap((name: string, index: number): Issue[] =>
      checkStep(pipeline, name, pipeline.steps[name], index + 1),
    ),
    ...checkGraph(pipeline, adjacency),
    ...checkDataFlow(pipeline, adjacency),
    ...checkSubstitution(pipeline),
  ];
};
