// Learned from factories-tools/pipeline-runner/src/features/pipeline/services/build-variables.service.ts
// and the substitution rules of factories-skills/any-factory/runner.md
import { mapValues } from '../../../shared/utils/fp.utils.js';
import { toAbsolute } from '../../../shared/utils/path.utils.js';
import type {
  ParamValues,
  Pipeline,
  ResolveContext,
  Scalar,
  Variables,
} from '../pipeline.types.js';
import { slugify, substitute } from '../pipeline.utils.js';

const asText = (values: Readonly<Record<string, Scalar>>): Record<string, string> =>
  mapValues((value: Scalar): string => String(value))(values);

/** `{{slug}}` is the main param — the first one declared — in kebab-case; the id when there is none. */
export const deriveSlug = (pipeline: Pipeline, params: ParamValues): string => {
  const main: string | undefined = Object.keys(pipeline.params ?? {})[0];
  const fromParam: string = main === undefined ? '' : slugify(String(params[main] ?? ''));
  return fromParam === '' ? pipeline.id : fromParam;
};

/** Constants are templates; everything else (params, built-ins, anchors) is data they may use. */
const expandConstants = (
  constants: Readonly<Record<string, string>>,
  data: Readonly<Record<string, string>>,
): Record<string, string> =>
  mapValues((value: string): string => substitute({ ...constants, ...data })(value))(constants);

/**
 * The substitution map, in the order runner.md gives it: `{{name}}` resolves from params, then
 * constants, then the built-ins id / slug / date, then the three anchors as the absolute places
 * they name — never as `cwd`, `.` or `~`. `outputDir` is resolved from that map, made absolute,
 * and added last, so a constant may build on it.
 */
export const buildVariables =
  (context: ResolveContext) =>
  (pipeline: Pipeline, params: ParamValues): Variables => {
    const data: Record<string, string> = {
      ...asText(params),
      id: pipeline.id,
      slug: deriveSlug(pipeline, params),
      date: context.date,
      ...context.anchors,
    };
    const constants: Record<string, string> = expandConstants(asText(pipeline.constants), data);
    const outputDir: string = toAbsolute(context.anchors.rootPath)(
      substitute({ ...constants, ...data })(pipeline.outputDir),
    );
    const withRun: Record<string, string> = { ...data, outputDir };
    return { ...expandConstants(constants, withRun), ...withRun };
  };
