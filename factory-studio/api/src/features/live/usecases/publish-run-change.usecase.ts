import type { AppLogger } from '../../../shared/types.js';
import type { RunRecordRead, RunsPayload } from '../../runs/runs.types.js';
import type { WorkspacesListResponse } from '../../workspaces/workspaces.types.js';
import type { ActiveRunTracker, RunChange, SubscriptionRegistry } from '../live.types.js';
import { capPaths, touchesRecord } from '../live.utils.js';

export interface PublishRunChangeSettings {
  registry: Pick<SubscriptionRegistry, 'publish' | 'count'>;
  readRunRecord: (folder: string, runId: string) => Promise<RunRecordRead>;
  listRuns: () => Promise<RunsPayload>;
  listWorkspaces: () => Promise<WorkspacesListResponse>;
  /** Hears every record read here, so the mtime sweep knows which runs are still moving. */
  tracker?: Pick<ActiveRunTracker, 'note' | 'noteRecords' | 'forget'>;
  logger?: AppLogger;
}

export interface RunChangePublisher {
  /** One debounced change to one run folder. */
  runChanged: (change: RunChange) => Promise<void>;
  /** A pipeline folder came or went, or the watcher lost track: everyone gets a fresh list. */
  rescan: () => Promise<void>;
  /** `run/workspaces.json` changed. */
  workspacesChanged: () => Promise<void>;
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Turns what the watcher saw under `run/` into frames for the `runs` and `workspaces`
 * subscribers. A change that touches a run's record files is re-read from disk and pushed as
 * the record (or `null` with the reason); a change to output files only carries the paths, so
 * an open document can reload itself. Nothing is read when nobody listens.
 */
export const publishRunChangeFactory = ({
  registry,
  readRunRecord,
  listRuns,
  listWorkspaces,
  tracker,
  logger,
}: PublishRunChangeSettings): RunChangePublisher => ({
  runChanged: async ({ folder, runId, paths }: RunChange): Promise<void> => {
    const shown: string[] = capPaths(paths);
    if (!touchesRecord(paths)) {
      if (registry.count('runs') > 0)
        registry.publish('runs', { type: 'run.changed', folder, runId, paths: shown });
      return;
    }
    try {
      // Read even with nobody listening: the sweep must learn when a run stops moving.
      const read: RunRecordRead = await readRunRecord(folder, runId);
      if (read.kind === 'record') tracker?.note(folder, runId, read.run.state?.status ?? 'IDLE');
      else tracker?.forget(folder, runId);
      if (registry.count('runs') === 0) return;
      if (read.kind === 'record') {
        registry.publish('runs', {
          type: 'run.changed',
          folder,
          runId,
          pipelineId: read.run.pipelineId,
          paths: shown,
          run: read.run,
        });
        return;
      }
      registry.publish('runs', {
        type: 'run.changed',
        folder,
        runId,
        paths: shown,
        run: null,
        reason: read.kind,
      });
    } catch (error: unknown) {
      logger?.warn('run change not published', { folder, runId, message: describe(error) });
    }
  },

  rescan: async (): Promise<void> => {
    try {
      const payload: RunsPayload = await listRuns();
      tracker?.noteRecords(payload.runs);
      if (registry.count('runs') > 0)
        registry.publish('runs', { type: 'runs.snapshot', ...payload });
    } catch (error: unknown) {
      logger?.warn('rescan not published', { message: describe(error) });
    }
  },

  workspacesChanged: async (): Promise<void> => {
    if (registry.count('workspaces') === 0) return;
    try {
      registry.publish('workspaces', { type: 'workspaces.snapshot', ...(await listWorkspaces()) });
    } catch (error: unknown) {
      logger?.warn('workspaces change not published', { message: describe(error) });
    }
  },
});
