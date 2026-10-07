import path from 'node:path';
import type { FileSystemAdapter } from '../../../adapters/file-system/index.js';
import { createAppError } from '../../../shared/utils/error.utils.js';
import { runStateSchema } from '../run.schema.js';
import type { RunState } from '../run.types.js';

const STATE_FILE = 'state.json';

export const stateFileOf = (runDir: string): string => path.join(runDir, STATE_FILE);

const isEmpty = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' && Object.keys(value).length === 0);

/** The shape on disk carries no empty frontier, edge map or vars, and lists steps by name. */
export const serializeState = ({
  frontier,
  edges,
  vars,
  steps,
  ...rest
}: RunState): Record<string, unknown> => ({
  ...rest,
  steps: Object.fromEntries(Object.entries(steps).sort(([a], [b]): number => a.localeCompare(b))),
  ...(isEmpty(frontier) ? {} : { frontier }),
  ...(isEmpty(edges) ? {} : { edges }),
  ...(isEmpty(vars) ? {} : { vars }),
});

export interface StateStore {
  exists: (runDir: string) => Promise<boolean>;
  save: (runDir: string, state: RunState) => Promise<void>;
  load: (runDir: string) => Promise<RunState>;
}

/** The only writer of state.json. Every save is atomic: a reader sees the old file or the new one. */
export const createStateStore = (fileSystem: FileSystemAdapter): StateStore => ({
  exists: (runDir: string): Promise<boolean> => fileSystem.exists(stateFileOf(runDir)),
  save: (runDir: string, state: RunState): Promise<void> =>
    fileSystem.writeJsonAtomic(stateFileOf(runDir), serializeState(state)),
  load: async (runDir: string): Promise<RunState> => {
    const file = stateFileOf(runDir);
    if (!(await fileSystem.exists(file)))
      throw createAppError('RUN_NOT_RESUMABLE', `no ${STATE_FILE} in ${runDir}`);
    const parsed = runStateSchema.safeParse(JSON.parse(await fileSystem.readText(file)) as unknown);
    if (!parsed.success) {
      throw createAppError(
        'RUN_NOT_RESUMABLE',
        `${file} was not written by pipeline-runner, or is damaged`,
        parsed.error.issues.map((issue): string => `${issue.path.join('.')}: ${issue.message}`),
      );
    }
    return parsed.data;
  },
});
