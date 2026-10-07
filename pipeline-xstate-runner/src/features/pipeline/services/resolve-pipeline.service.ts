// Learned from factories-tools/pipeline-runner/src/features/pipeline/services/resolve-pipeline.service.ts
import type { Result } from '../../../shared/types/result.types.js';
import { pipe } from '../../../shared/utils/fp.utils.js';
import { toAbsolute } from '../../../shared/utils/path.utils.js';
import { map } from '../../../shared/utils/result.utils.js';
import type {
  ParamValues,
  Pipeline,
  ResolveContext,
  ResolvedHooks,
  ResolvedPipeline,
  ResolvedStep,
  Step,
  Variables,
} from '../pipeline.types.js';
import { HUMAN_AGENT, joinLines, substitute } from '../pipeline.utils.js';
import { buildVariables } from './build-variables.service.js';
import { resolveParams } from './resolve-params.service.js';

/**
 * One step with every `{{name}}` filled and every path made absolute: input and output hang off
 * the run folder, knowledge and workDir off the repository root. `agent`, `model` and
 * `transitions` take no substitution; they are read as written.
 */
export const resolveStep =
  (variables: Variables, rootPath: string) =>
  (name: string, step: Step): ResolvedStep => {
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
      input: (step.input ?? []).map(underRun),
      output: (step.output ?? []).map(underRun),
      knowledge: (step.knowledge ?? []).map(underRoot),
      workDir:
        step.workDir === undefined ? (variables['outputDir'] ?? rootPath) : underRoot(step.workDir),
      transitions: step.transitions,
    };
  };

const resolveHooks =
  (variables: Variables) =>
  (pipeline: Pipeline): ResolvedHooks => ({
    before: (pipeline.hooks?.before ?? []).map(substitute(variables)),
    after: (pipeline.hooks?.after ?? []).map(substitute(variables)),
  });

/**
 * Pure: the same pipeline and the same context give the same resolved pipeline, byte for byte.
 * Everything the outside world contributes arrives in `context` as data. A param that does not
 * fit is a refusal, so a run never starts on a blank.
 */
export const resolvePipeline =
  (context: ResolveContext) =>
  (file: string, pipeline: Pipeline): Result<ResolvedPipeline> =>
    map((params: ParamValues): ResolvedPipeline => {
      const variables: Variables = buildVariables(context)(pipeline, params);
      const toStep = resolveStep(variables, context.anchors.rootPath);
      return {
        id: pipeline.id,
        file,
        anchors: context.anchors,
        outputDir: variables['outputDir'] ?? '',
        params,
        constants: pipeline.constants,
        variables,
        hooks: resolveHooks(variables)(pipeline),
        start: [...pipeline.START],
        steps: Object.fromEntries(
          Object.entries(pipeline.steps).map(
            ([name, step]: [string, Step]): [string, ResolvedStep] => [name, toStep(name, step)],
          ),
        ),
      };
    })(resolveParams(pipeline)(context.suppliedParams));
