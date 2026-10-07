import type { Result } from '../../../shared/types/result.types.js';
import { chain, map } from '../../../shared/utils/result.utils.js';
import type { Edge, Pipeline, Step } from '../../pipeline/pipeline.types.js';
import { END } from '../../pipeline/pipeline.utils.js';
import { loadPipelineFactory } from '../../pipeline/services/load-pipeline.service.js';
import { locatePipelineFactory } from '../../pipeline/services/locate-pipeline.service.js';
import type { RunDeps } from '../run.types.js';

/** A statechart for the eye: one state per step, one transition per event. Never executed. */
export interface VisualStatechart {
  id: string;
  initial: string;
  states: Record<
    string,
    { on?: Record<string, string | string[]>; type?: 'final'; meta?: Record<string, unknown> }
  >;
}

const targetOf = (edge: Edge): string | string[] => {
  const targets: string[] = edge.target.map((target: string): string =>
    target === END ? 'END' : target,
  );
  return targets.length === 1 ? (targets[0] as string) : targets;
};

/** compile = the pipeline as a visual statechart (for the Stately visualiser and docs). */
export const compilePipeline = (pipeline: Pipeline): VisualStatechart => ({
  id: pipeline.id,
  initial: pipeline.START[0] ?? END,
  states: {
    ...Object.fromEntries(
      Object.entries(pipeline.steps).map(([name, step]: [string, Step]) => [
        name,
        {
          on: Object.fromEntries(
            Object.entries(step.transitions).map(([event, edge]: [string, Edge]) => [
              event,
              targetOf(edge),
            ]),
          ),
          meta: {
            agent: step.agent,
            ...(step.model === undefined ? {} : { model: step.model }),
            ...Object.fromEntries(
              Object.entries(step.transitions)
                .filter(
                  ([, edge]: [string, Edge]) =>
                    edge.max !== undefined || edge.condition !== undefined,
                )
                .map(([event, edge]: [string, Edge]) => [
                  event,
                  {
                    ...(edge.max === undefined ? {} : { max: edge.max }),
                    ...(edge.onMax === undefined ? {} : { onMax: edge.onMax }),
                    ...(edge.condition === undefined ? {} : { condition: edge.condition }),
                  },
                ]),
            ),
          },
        },
      ]),
    ),
    END: { type: 'final' },
  },
});

export const compilePipelineUsecaseFactory =
  (deps: Pick<RunDeps, 'fileSystem' | 'rootPath' | 'cwd'>) =>
  (pipelineRef: string | undefined): Result<VisualStatechart> =>
    chain((file: string): Result<VisualStatechart> =>
      map(compilePipeline)(loadPipelineFactory(deps.fileSystem)(file)),
    )(locatePipelineFactory(deps.fileSystem)(deps.rootPath, deps.cwd)(pipelineRef));
