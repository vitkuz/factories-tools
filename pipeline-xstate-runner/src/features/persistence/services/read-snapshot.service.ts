import type { FileSystemClient } from '../../../clients/file-system/types.js';
import type { Result } from '../../../shared/types/result.types.js';
import { errorMessage } from '../../../shared/utils/error.utils.js';
import { ok, refuse } from '../../../shared/utils/result.utils.js';
import { MACHINE_VERSION, RUNNER_NAME } from '../../machines/machines.types.js';
import { snapshotFileSchema } from '../persistence.schema.js';
import type { SnapshotFile } from '../persistence.types.js';
import { snapshotPathFor } from './write-run-files.service.js';

export const SNAPSHOT_CHECKS = {
  exists: {
    id: 'snapshot-exists',
    description: `The run folder holds a snapshot.json written by ${RUNNER_NAME}.`,
  },
  valid: { id: 'snapshot-valid', description: 'snapshot.json is JSON of the expected shape.' },
  version: {
    id: 'snapshot-version-matches',
    description: `snapshot.json was written by machine version ${MACHINE_VERSION}: an older or newer one is refused.`,
  },
} as const;

/** The persisted run machine snapshot, when this version of the runner can continue it. */
export const readSnapshotFactory =
  (fileSystem: FileSystemClient) =>
  (runDir: string): Result<SnapshotFile> => {
    const file: string = snapshotPathFor(runDir);
    if (!fileSystem.exists(file)) {
      return refuse(SNAPSHOT_CHECKS.exists.id)(
        `no snapshot.json in ${runDir}: this run was not made by ${RUNNER_NAME}, or never got past validation`,
      );
    }
    const parsed = ((): ReturnType<typeof snapshotFileSchema.safeParse> | Error => {
      try {
        return snapshotFileSchema.safeParse(JSON.parse(fileSystem.readText(file)) as unknown);
      } catch (error: unknown) {
        return new Error(errorMessage(error));
      }
    })();
    if (parsed instanceof Error) {
      return refuse(SNAPSHOT_CHECKS.valid.id)(`${file} is not valid JSON: ${parsed.message}`);
    }
    if (!parsed.success) {
      return refuse(SNAPSHOT_CHECKS.valid.id)(`${file} is not a snapshot file`);
    }
    if (parsed.data.machineVersion !== MACHINE_VERSION) {
      return refuse(SNAPSHOT_CHECKS.version.id)(
        `${file} was written by machine version ${parsed.data.machineVersion}; this runner is version ${MACHINE_VERSION} and cannot continue it`,
      );
    }
    return ok(parsed.data);
  };
