import { pipe } from '../../../shared/utils/fp.utils.js';
import type {
  HooksDefinition,
  LoadedPipeline,
  ParamValues,
  ResolveContext,
  ResolvedPipeline,
  ResolvedStep,
  StepDefinition,
  Variables,
} from '../pipeline.types.js';
import { joinLines, substitute, toAbsolute } from '../pipeline.utils.js';
import { buildVariables } from './build-variables.service.js';
import { resolveParams } from './resolve-params.service.js';

const HUMAN_AGENT = 'human';

/**
 * One step with every `{{name}}` filled and every path made absolute:
 * input and output hang off the run folder, knowledge and workDir off the repository root.
 * `agent`, `model` and `on` take no substitution; they are read as written.
 */
export const resolveStep =
  (variables: Variables, rootPath: string) =>
  (name: string, step: StepDefinition): ResolvedStep => {
    const fill = substitute(variables);
    const underRun = pipe(fill, toAbsolute(variables['outputDir'] ?? rootPath));
    const underRoot = pipe(fill, toAbsolute(rootPath));
    return {
      name,
      agent: step.agent,
      isHuman: step.agent === HUMAN_AGENT,
      ...(step.model === undefined ? {} : { model: step.model }),
      prompt: fill(joinLines(step.prompt)),
      ...(step.system === undefined ? {} : { systemPrompt: fill(joinLines(step.system)) }),
      input: step.input.map(underRun),
      output: step.output.map(underRun),
      knowledge: step.knowledge.map(underRoot),
      workDir:
        step.workDir === undefined ? (variables['outputDir'] ?? rootPath) : underRoot(step.workDir),
      transitions: step.transitions,
    };
  };

const resolveHooks =
  (variables: Variables) =>
  (hooks: HooksDefinition): HooksDefinition => ({
    before: hooks.before.map(substitute(variables)),
    after: hooks.after.map(substitute(variables)),
  });

/**
 * Pure: the same definition and the same context give the same resolved pipeline, byte for byte.
 * Everything the outside world contributes arrives in `context` as data.
 */
export const resolvePipeline =
  (context: ResolveContext) =>
  ({ file, definition, warnings }: LoadedPipeline): ResolvedPipeline => {
    const params: ParamValues = resolveParams(definition)(context.suppliedParams);
    const variables: Variables = buildVariables(context)(definition, params);
    const toStep = resolveStep(variables, context.anchors.rootPath);
    return {
      id: definition.id,
      ...(definition.description === undefined ? {} : { description: definition.description }),
      file,
      anchors: context.anchors,
      outputDir: variables['outputDir'] ?? '',
      params,
      variables,
      hooks: resolveHooks(variables)(definition.hooks),
      start: definition.START,
      steps: Object.fromEntries(
        Object.entries(definition.steps).map(
          ([name, step]: [string, StepDefinition]): [string, ResolvedStep] => [
            name,
            toStep(name, step),
          ],
        ),
      ),
      warnings,
    };
  };
