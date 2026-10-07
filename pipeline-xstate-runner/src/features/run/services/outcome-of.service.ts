import type { State } from '../../state/state.types.js';
import { buildRunReport } from './build-run-report.service.js';
import type { RunSnapshot } from './drive-run.service.js';
import type { RunOutcome } from '../run.types.js';

/** What a rested run means for the caller. */
export const outcomeOf = (snapshot: RunSnapshot): RunOutcome => {
  const state: State | undefined = snapshot.context.state;
  if (state === undefined || snapshot.context.error !== undefined) {
    return {
      kind: 'refused',
      guard:
        snapshot.matches('failed') && snapshot.context.validation?.ok === false
          ? 'validation'
          : 'open',
      message: snapshot.context.error ?? 'the run never opened',
    };
  }
  const report = buildRunReport(snapshot.context, state);
  if (snapshot.matches('parked')) return { kind: 'parked', report, state };
  if (snapshot.matches('stopped')) return { kind: 'stopped', report, state };
  return { kind: state.status === 'COMPLETED' ? 'completed' : 'failed', report, state };
};
