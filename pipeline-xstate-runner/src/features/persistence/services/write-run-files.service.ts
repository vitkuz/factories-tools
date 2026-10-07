import path from 'node:path';
import type { FileSystemClient } from '../../../clients/file-system/types.js';
import { MACHINE_VERSION, RUNNER_NAME } from '../../machines/machines.types.js';
import type { State } from '../../state/state.types.js';
import { serializeState, statePathFor } from '../../state/state.utils.js';
import type { SnapshotFile } from '../persistence.types.js';
import { EVENTS_FILE, SNAPSHOT_FILE } from '../persistence.types.js';

export const snapshotPathFor = (runDir: string): string => path.join(runDir, SNAPSHOT_FILE);
export const eventsPathFor = (runDir: string): string => path.join(runDir, EVENTS_FILE);

/** state.json, atomically: a reader sees the old file or the new one, never half of either. */
export const writeStateFileFactory =
  (fileSystem: FileSystemClient) =>
  (runDir: string, state: State): void =>
    fileSystem.writeTextAtomic(statePathFor(runDir), serializeState(state));

/** snapshot.json, atomically, with the machine version that wrote it. */
export const writeSnapshotFileFactory =
  (fileSystem: FileSystemClient) =>
  (runDir: string, snapshot: unknown): void => {
    const file: SnapshotFile = { runner: RUNNER_NAME, machineVersion: MACHINE_VERSION, snapshot };
    fileSystem.writeTextAtomic(snapshotPathFor(runDir), `${JSON.stringify(file, null, 2)}\n`);
  };

/** One more line of events.jsonl: append-only, so a crash loses at most the line being written. */
export const appendEventFactory =
  (fileSystem: FileSystemClient) =>
  (runDir: string, seq: number, event: unknown): void =>
    fileSystem.appendLine(eventsPathFor(runDir), JSON.stringify({ seq, event }));
