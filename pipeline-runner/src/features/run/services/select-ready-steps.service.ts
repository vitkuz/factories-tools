import { forwardSuccessors, reachableFrom } from '../../pipeline/index.js';
import type { ResolvedPipeline } from '../../pipeline/index.js';
import type { RunState } from '../run.types.js';

const LIVE: readonly string[] = ['PENDING', 'RUNNING'];

/**
 * Which steps may start right now.
 *
 * A step on the frontier is held back while anything still alive sits upstream of it. That one
 * rule is fan-in: when `plan` and `design` both point at `build`, `build` is on the frontier the
 * moment `plan` finishes, but `design` is alive and upstream — so `build` waits, then runs once.
 *
 * "Upstream" is measured on the graph with its loop-closing edges removed. A reviewer can route
 * back into the builder, but it is not upstream of it; without this, a loop would deadlock.
 * What is left is a DAG, so some live step always has nothing alive above it: the run cannot stall.
 */
export const selectReadyStepsFactory = (
  pipeline: ResolvedPipeline,
): ((state: RunState) => string[]) => {
  const downstreamOf = reachableFrom(forwardSuccessors(pipeline.steps, pipeline.start));
  const isUpstream = (other: string, name: string): boolean =>
    other !== name && downstreamOf([other]).has(name);

  return (state: RunState): string[] => {
    const live: string[] = state.frontier.filter((name: string): boolean =>
      LIVE.includes(state.steps[name]?.status ?? ''),
    );
    return live
      .filter((name: string): boolean => state.steps[name]?.status === 'PENDING')
      .filter(
        (name: string): boolean => !live.some((other: string): boolean => isUpstream(other, name)),
      );
  };
};
