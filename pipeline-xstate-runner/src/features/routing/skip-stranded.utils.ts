// Learned from factories-tools/run-state/src/features/routing/skip-stranded.utils.ts
import { allNeighbours, reachableVia } from '../pipeline/pipeline.utils.js';
import type { Graph } from '../pipeline/pipeline.utils.js';
import type { State, StepRecord, Transition } from '../state/state.types.js';
import { liveOf, skipStep, stepEntriesOf } from '../state/state.utils.js';
import { flow } from '../../shared/utils/fp.utils.js';

/** Never-started steps that nothing live (running or routed) can reach any more, by any edge. */
export const strandedSteps =
  (pipeline: Graph) =>
  (state: State): string[] => {
    const reachable: Set<string> = reachableVia(allNeighbours)(pipeline)(liveOf(state));
    return stepEntriesOf(state)
      .filter(
        ([name, step]: [string, StepRecord]): boolean =>
          step.status === 'PENDING' && !step.passes && !reachable.has(name),
      )
      .map(([name]: [string, StepRecord]): string => name);
  };

/** Close every stranded step as SKIPPED at `at`, `because` the route that stranded it. */
export const skipStranded =
  (pipeline: Graph) =>
  (at: string, because: string): Transition =>
  (state: State): State =>
    flow<State>(
      ...strandedSteps(pipeline)(state).map((name: string): Transition =>
        skipStep(at)(name, `${because} and nothing routes here any more`, true),
      ),
    )(state);
