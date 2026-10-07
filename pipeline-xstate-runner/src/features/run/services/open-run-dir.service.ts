import type { Result } from '../../../shared/types/result.types.js';
import { chain, ok, refuse } from '../../../shared/utils/result.utils.js';
import type { RunContext } from '../../machines/machines.types.js';
import { readSnapshotFactory } from '../../persistence/services/read-snapshot.service.js';
import type { SnapshotFile } from '../../persistence/persistence.types.js';
import { readStateFactory } from '../../state/services/read-state.service.js';
import type { State } from '../../state/state.types.js';
import type { RunDeps } from '../run.types.js';

export const RESUME_CHECK = {
  id: 'run-is-resumable',
  description:
    'The snapshot rests in running (a crash), parked (a human step) or stopped (Ctrl-C); a finished run, or one that never reached its steps, is not resumed.',
} as const;

/** A stored run, read back: its snapshot (checked), its state.json (checked) and the context inside. */
export interface StoredRun {
  runDir: string;
  snapshot: SnapshotFile;
  state: State;
  context: RunContext;
  /** The run machine's state value as persisted: 'running', 'parked', 'stopped', … */
  value: string;
}

const RESUMABLE: readonly string[] = ['running', 'parked', 'stopped'];

/** Where a run rests, and whether it can go on from there. */
export const openRunDirFactory =
  (deps: RunDeps) =>
  (runDir: string): Result<StoredRun> =>
    chain((snapshot: SnapshotFile): Result<StoredRun> =>
      chain((state: State): Result<StoredRun> => {
        const persisted = snapshot.snapshot as {
          value?: unknown;
          status?: unknown;
          context?: unknown;
        };
        const value: string = typeof persisted.value === 'string' ? persisted.value : '';
        if (persisted.status !== 'active' || !RESUMABLE.includes(value)) {
          return refuse(RESUME_CHECK.id)(
            `${runDir} rests in "${value || String(persisted.status)}" (${state.status}): nothing to resume`,
          );
        }
        return ok({ runDir, snapshot, state, context: persisted.context as RunContext, value });
      })(readStateFactory(deps.fileSystem)(runDir)),
    )(readSnapshotFactory(deps.fileSystem)(runDir));
