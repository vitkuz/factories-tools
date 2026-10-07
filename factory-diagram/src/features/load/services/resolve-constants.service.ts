import { createAppError } from '../../../shared/utils/error.utils.js';
import type { PipelineDefinition, Scalar, Variables } from '../load.types.js';
import {
  ANCHOR_NAMES,
  asText,
  expandVariables,
  substitute,
  wrapperSkillPath,
  type Expansion,
} from '../load.utils.js';

export interface DrawingAnchors {
  rootPath: string;
  homePath: string;
}

/** Params with a default worth showing; an empty default means "ask", so it stays `{{name}}` in the picture. */
const defaultedParams = (definition: PipelineDefinition): Record<string, Scalar> =>
  Object.fromEntries(
    Object.entries(definition.params).filter(
      ([, value]: [string, Scalar]): boolean => value !== '',
    ),
  );

/**
 * The runner's substitution map, built from what a drawing can know before a run: constants,
 * then param defaults laid over them, then `id`, `slug` (= id, no main param typed) and the
 * three anchors as the absolute places they name. `{{date}}` and `{{outputDir}}` are left as
 * written so the same pipeline draws the same bytes every day.
 */
export const resolveVariables =
  (anchors: DrawingAnchors) =>
  (definition: PipelineDefinition): Variables => {
    const params: Record<string, string> = asText(defaultedParams(definition));
    const raw: Record<string, string> = {
      ...asText(definition.constants),
      ...params,
      id: definition.id,
      slug: definition.id,
      rootPath: anchors.rootPath,
      skillPath: wrapperSkillPath(anchors.rootPath)(definition.id),
      homePath: anchors.homePath,
    };
    const literals: Set<string> = new Set([...Object.keys(params), ...ANCHOR_NAMES, 'id', 'slug']);
    const { variables, cycles }: Expansion = expandVariables(raw, literals);
    if (cycles.length > 0) {
      throw createAppError(
        'PIPELINE_INVALID',
        'variables refer to each other in a circle',
        cycles.map((cycle: string): string => `cycle: ${cycle}`),
      );
    }
    return variables;
  };

export const resolveOutputDir = (variables: Variables, definition: PipelineDefinition): string =>
  substitute(variables)(definition.outputDir);
