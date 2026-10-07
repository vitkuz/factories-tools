import { flow } from '../../../shared/utils/fp.utils.js';
import type { ConditionScope } from '../../condition/index.js';
import type { ResolvedPipeline, ResolvedStep } from '../../pipeline/index.js';
import { completeStep, failStep, skipUnreachable } from '../run-state.utils.js';
import type { RouteDecision, RunState, StepOutcome } from '../run.types.js';
import { routeEvent } from './route-event.service.js';

export interface Settled {
  state: RunState;
  /** Set when this outcome ends the run: a failed step, or a move the graph refused. */
  halt?: string;
}

/**
 * Names in a condition resolve, weakest first: built-ins and constants, then params, then every
 * value a step has reported so far in this run, then what this step reported with this event.
 */
const scopeOf = (
  pipeline: ResolvedPipeline,
  state: RunState,
  outcome: Extract<StepOutcome, { kind: 'event' }>,
): ConditionScope => ({
  ...pipeline.variables,
  ...pipeline.params,
  ...state.vars,
  ...outcome.reported,
});

/**
 * Pure. One finished step, applied to the state: the event is routed by the graph, the record is
 * updated, the frontier moves, and branches the route closed are skipped. A refusal by the graph
 * is final — it is recorded and it halts the run; it is never routed around.
 */
export const settleOutcome =
  (pipeline: ResolvedPipeline) =>
  (at: string) =>
  (state: RunState, outcome: StepOutcome): Settled => {
    if (outcome.kind === 'error') {
      return {
        state: failStep(at)(outcome.step, outcome.error)(state),
        halt: `step "${outcome.step}" failed: ${outcome.error}`,
      };
    }
    const step: ResolvedStep | undefined = pipeline.steps[outcome.step];
    if (step === undefined) return { state, halt: `step "${outcome.step}" is not in the graph` };

    const decision: RouteDecision = routeEvent(step)(
      state.edges,
      scopeOf(pipeline, state, outcome),
    )(outcome.event);
    if (decision.kind === 'refused') {
      const routing = {
        edge: decision.edge,
        targets: [],
        ...(decision.capped === undefined ? {} : { capped: decision.capped }),
      };
      return { state: completeStep(at)(outcome, routing)(state), halt: decision.reason };
    }
    return {
      state: flow(
        completeStep(at)(outcome, decision),
        skipUnreachable(at, pipeline)(outcome.step, outcome.event),
      )(state),
    };
  };
