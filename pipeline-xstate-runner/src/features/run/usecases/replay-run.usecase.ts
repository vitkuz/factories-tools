import { createActor } from 'xstate';
import type { Result } from '../../../shared/types/result.types.js';
import { ok, refuse } from '../../../shared/utils/result.utils.js';
import { createRunMachine } from '../../machines/run.machine.js';
import type { RunContext, RunEvent } from '../../machines/machines.types.js';
import { readEventsFactory } from '../../persistence/services/read-events.service.js';
import { readSnapshotFactory } from '../../persistence/services/read-snapshot.service.js';
import type { EventLine } from '../../persistence/persistence.types.js';
import { readStateFactory } from '../../state/services/read-state.service.js';
import { serializeState } from '../../state/state.utils.js';
import { createInertEffects } from '../services/create-inert-effects.service.js';
import type { RunDeps } from '../run.types.js';

export interface ReplayReport {
  runDir: string;
  events: number;
  /** True when re-feeding the events rebuilt state.json byte for byte. */
  matches: boolean;
  /** The rebuilt state.json text, when it differs: what to diff against the file. */
  rebuilt?: string;
}

export const REPLAY_CHECK = {
  id: 'replay-reproduces-state',
  description:
    'Re-feeding events.jsonl into a run machine with inert actors rebuilds state.json exactly.',
} as const;

/**
 * replay = the run machine, with effects that never settle, fed every event it received, in order.
 * Every record came in through those events (each carries its own `at`), so the context after the
 * last one must serialize to the state.json on disk. A difference is drift: in the machine, or in
 * the file.
 */
export const replayRunFactory =
  (deps: Pick<RunDeps, 'fileSystem'>) =>
  (runDir: string): Result<ReplayReport> => {
    const snapshot = readSnapshotFactory(deps.fileSystem)(runDir);
    if (!snapshot.ok) return snapshot;
    const events = readEventsFactory(deps.fileSystem)(runDir);
    if (!events.ok) return events;
    const stored = readStateFactory(deps.fileSystem)(runDir);
    if (!stored.ok) return stored;

    const persisted = snapshot.value.snapshot as { context: RunContext };
    const actor = createActor(createRunMachine(createInertEffects()), {
      input: persisted.context.input,
    });
    actor.start();
    events.value.forEach((line: EventLine): void => {
      actor.send(line.event as unknown as RunEvent);
    });
    const rebuilt = actor.getSnapshot().context.state;
    actor.stop();
    if (rebuilt === undefined) {
      return refuse(REPLAY_CHECK.id)(`${runDir}: the replayed run never opened`);
    }
    const expected: string = serializeState(stored.value);
    const actual: string = serializeState(rebuilt);
    return ok({
      runDir,
      events: events.value.length,
      matches: actual === expected,
      ...(actual === expected ? {} : { rebuilt: actual }),
    });
  };
