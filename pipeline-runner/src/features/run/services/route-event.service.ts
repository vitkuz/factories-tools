import { errorMessage } from '../../../shared/utils/error.utils.js';
import { evaluateCondition, type ConditionScope } from '../../condition/index.js';
import type { EdgeDefinition, ResolvedStep } from '../../pipeline/index.js';
import type { RouteDecision } from '../run.types.js';

export const edgeName = (step: string, event: string): string => `${step}:${event}`;

const conditionHolds = (scope: ConditionScope, condition: string): true | string => {
  try {
    return evaluateCondition(scope)(condition) ? true : `its condition "${condition}" is false`;
  } catch (error) {
    return errorMessage(error);
  }
};

/**
 * The graph chooses the edge — not the runner's mood and not the subagent. Given the same step,
 * the same counters and the same scope, an event routes to the same place every time:
 *   1. a condition on the edge must hold, or the edge is not taken and the run has nowhere to go;
 *   2. the traversal is counted; `max: 2` allows the edge twice and diverts the third to `onMax`;
 *   3. a spent cap with no `onMax` is a stop sign.
 * The caller has already made sure `event` is one of the step's events.
 */
export const routeEvent =
  (step: ResolvedStep) =>
  (counters: Readonly<Record<string, number>>, scope: ConditionScope) =>
  (event: string): RouteDecision => {
    const edge: EdgeDefinition | undefined = step.transitions[event];
    const key = edgeName(step.name, event);
    if (edge === undefined)
      return {
        kind: 'refused',
        edge: key,
        reason: `step "${step.name}" declares no event ${event}`,
      };

    const holds: true | string =
      edge.condition === undefined ? true : conditionHolds(scope, edge.condition);
    if (holds !== true)
      return { kind: 'refused', edge: key, reason: `edge ${key} is not taken: ${holds}` };

    const traversal = (counters[key] ?? 0) + 1;
    if (edge.max === undefined || traversal <= edge.max)
      return { kind: 'routed', edge: key, targets: [...edge.target] };

    const capped: { max: number; onMax: string[] } = {
      max: edge.max,
      onMax: [...(edge.onMax ?? [])],
    };
    return capped.onMax.length > 0
      ? { kind: 'routed', edge: key, targets: capped.onMax, capped }
      : {
          kind: 'refused',
          edge: key,
          capped,
          reason: `edge ${key} spent its cap of ${edge.max} and declares no onMax`,
        };
  };
