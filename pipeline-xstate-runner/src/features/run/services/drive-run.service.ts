import { createActor } from 'xstate';
import type { AnyEventObject, InspectionEvent, Snapshot, SnapshotFrom } from 'xstate';
import type { FileSystemClient } from '../../../clients/file-system/types.js';
import { createRunMachine } from '../../machines/run.machine.js';
import type { RunMachine } from '../../machines/run.machine.js';
import type { RunContext, RunEffects, RunEvent, RunInput } from '../../machines/machines.types.js';
import {
  appendEventFactory,
  writeSnapshotFileFactory,
  writeStateFileFactory,
} from '../../persistence/services/write-run-files.service.js';
import type { RunDeps } from '../run.types.js';

export type RunSnapshot = SnapshotFrom<RunMachine>;

/** A new run starts from its input; a continued one from its persisted snapshot. */
export type RunStart = { input: RunInput } | { snapshot: unknown };

export interface DriveRequest {
  effects: RunEffects;
  start: RunStart;
  /** The event that sets a restored run in motion (RESUME, HUMAN.ANSWER). */
  kick?: RunEvent;
}

/** The run writes nothing until it owns its folder: after `opening`, and only when it did open. */
export const isPersistable = (snapshot: RunSnapshot): boolean =>
  snapshot.context.state !== undefined &&
  snapshot.context.error === undefined &&
  !snapshot.matches('validating') &&
  !snapshot.matches('resolving') &&
  !snapshot.matches('opening');

/** A run rests when it is over, waits for a person, or was interrupted. */
export const isAtRest = (snapshot: RunSnapshot): boolean =>
  snapshot.status !== 'active' || snapshot.matches('parked') || snapshot.matches('stopped');

/** A child never survives a process: the run machine re-runs whatever was in flight as a new pass. */
export const withoutChildren = (snapshot: unknown): unknown => ({
  ...(snapshot as Record<string, unknown>),
  children: {},
});

/** True for an event the run machine received from outside itself: what replay must re-feed. */
const isReplayableRootEvent = (
  inspection: InspectionEvent,
): inspection is InspectionEvent & {
  type: '@xstate.event';
} =>
  inspection.type === '@xstate.event' &&
  inspection.actorRef.sessionId === inspection.rootId &&
  inspection.sourceRef?.sessionId !== inspection.rootId &&
  !inspection.event.type.startsWith('xstate.init');

/**
 * events.jsonl, append-only. Events arrive before the run owns a folder (the validation result,
 * for one), so they wait in memory until the first persist and are flushed then, in order.
 */
const createEventLog = (fileSystem: FileSystemClient) => {
  const append = appendEventFactory(fileSystem);
  const pending: AnyEventObject[] = [];
  let seq = 0;
  let runDir: string | undefined;
  return {
    record: (event: AnyEventObject): void => {
      if (runDir === undefined) pending.push(event);
      else append(runDir, (seq += 1), event);
    },
    flush: (dir: string): void => {
      if (runDir !== undefined) return;
      runDir = dir;
      pending.splice(0).forEach((event: AnyEventObject): void => append(dir, (seq += 1), event));
    },
  };
};

/**
 * Create the run actor, persist state.json, snapshot.json and events.jsonl after every
 * transition, wire Ctrl-C, start it (and kick it), and wait until it rests.
 */
export const driveRunFactory =
  (deps: RunDeps) =>
  (request: DriveRequest): Promise<RunSnapshot> =>
    new Promise<RunSnapshot>((resolve, reject): void => {
      const machine = createRunMachine(request.effects);
      const writeState = writeStateFileFactory(deps.fileSystem);
      const writeSnapshot = writeSnapshotFileFactory(deps.fileSystem);
      const events = createEventLog(deps.fileSystem);

      const persist = (snapshot: RunSnapshot): void => {
        if (!isPersistable(snapshot)) return;
        const context: RunContext = snapshot.context;
        const runDir: string = context.pipeline?.outputDir ?? '';
        writeState(runDir, context.state!);
        writeSnapshot(runDir, actor.getPersistedSnapshot());
        events.flush(runDir);
      };

      const actor = createActor(machine, {
        // A restored run ignores `input`; the option is still required, so it gets the one it had.
        ...('input' in request.start
          ? { input: request.start.input }
          : {
              input: (request.start.snapshot as { context: RunContext }).context.input,
              snapshot: withoutChildren(request.start.snapshot) as Snapshot<unknown>,
            }),
        ...(deps.delays === undefined ? {} : { clock: deps.delays }),
        inspect: (inspection: InspectionEvent): void => {
          if (isReplayableRootEvent(inspection)) events.record(inspection.event);
          deps.inspect?.(inspection);
        },
      });

      // A snapshot seen before the kick is where the run rested last time, not where it rests now.
      let armed: boolean = request.kick === undefined;
      actor.subscribe({
        next: (snapshot: RunSnapshot): void => {
          persist(snapshot);
          if (armed && isAtRest(snapshot)) {
            actor.stop();
            resolve(snapshot);
          }
        },
        error: (error: unknown): void =>
          reject(error instanceof Error ? error : new Error(String(error))),
      });

      const cancel = (): void => actor.send({ type: 'CANCEL', at: deps.clock.now() });
      deps.signal?.addEventListener('abort', cancel, { once: true });

      actor.start();
      if (request.kick !== undefined) {
        armed = true;
        actor.send(request.kick);
      }
    });
