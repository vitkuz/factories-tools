import { createAppError } from '../../../shared/utils/error.utils.js';
import type {
  ParamValues,
  PipelineDefinition,
  ResolveContext,
  Scalar,
  Variables,
} from '../pipeline.types.js';
import {
  ANCHOR_NAMES,
  BUILTIN_NAMES,
  expandVariables,
  placeholdersIn,
  slugify,
  toAbsolute,
  type Expansion,
} from '../pipeline.utils.js';

const asText = (values: Readonly<Record<string, Scalar>>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(values).map(([name, value]: [string, Scalar]): [string, string] => [
      name,
      String(value),
    ]),
  );

/** `{{slug}}` is the main param — the first one declared — in kebab-case. */
const deriveSlug = (definition: PipelineDefinition, params: ParamValues): string => {
  const main: string | undefined = Object.keys(definition.params)[0];
  const fromParam = main === undefined ? '' : slugify(String(params[main] ?? ''));
  return fromParam === '' ? definition.id : fromParam;
};

const expandOrThrow = (
  raw: Record<string, string>,
  literals: ReadonlySet<string>,
): Record<string, string> => {
  const { variables, cycles }: Expansion = expandVariables(raw, literals);
  if (cycles.length > 0) {
    throw createAppError(
      'VARIABLES_INVALID',
      'variables refer to each other in a circle',
      cycles.map((cycle: string): string => `cycle: ${cycle}`),
    );
  }
  return variables;
};

/**
 * The substitution map, in the order runner.md gives it:
 *   constants, then params laid over them (a param wins), then the built-ins id / slug / date,
 *   then the three anchors as the absolute places they name — never as `cwd`, `.` or `~`.
 * `outputDir` is resolved from that map, made absolute, and added last.
 */
export const buildVariables =
  (context: ResolveContext) =>
  (definition: PipelineDefinition, params: ParamValues): Variables => {
    const raw: Record<string, string> = {
      ...asText(definition.constants),
      ...asText(params),
      id: definition.id,
      slug: context.slug ?? deriveSlug(definition, params),
      date: context.date,
      ...context.anchors,
      outputDir: definition.outputDir,
    };
    // What the user typed and what the machine supplied is data. Only constants and outputDir are templates.
    const data: string[] = [...Object.keys(params), ...ANCHOR_NAMES, 'id', 'slug', 'date'];

    const first: Record<string, string> = expandOrThrow(raw, new Set(data));
    const outputDir = toAbsolute(context.anchors.rootPath)(first['outputDir'] ?? '');
    const unresolved: string[] = placeholdersIn(outputDir);
    if (unresolved.length > 0) {
      throw createAppError('VARIABLES_INVALID', 'outputDir could not be resolved', [
        `still holds ${unresolved.map((name: string): string => `{{${name}}}`).join(', ')}`,
      ]);
    }
    // Second pass with the absolute run folder pinned, so a constant built on {{outputDir}} gets that.
    return expandOrThrow({ ...raw, outputDir }, new Set([...data, ...BUILTIN_NAMES]));
  };
