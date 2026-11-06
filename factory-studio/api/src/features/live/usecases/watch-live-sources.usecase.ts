import path from 'node:path';
import type { WatchClient, WatchEvent } from '../../../clients/watch/watch.types.js';
import type { AppLogger } from '../../../shared/types.js';
import { debounceByKey, type KeyedDebouncer } from '../../../shared/utils/debounce.utils.js';
import { RUN_DIR } from '../../runs/runs.utils.js';
import type { LiveWatchers, RunPathKind } from '../live.types.js';
import { classifyRunPath, isPipelineFile } from '../live.utils.js';
import type { RunChangePublisher } from './publish-run-change.usecase.js';

export interface WatchLiveSourcesSettings {
  watch: WatchClient;
  workDir: string;
  publisher: RunChangePublisher;
  publishPipelines: () => Promise<void>;
  /** The fold of a run's burst of file events into one push. */
  runDebounceMs?: number;
  pipelinesDebounceMs?: number;
  logger?: AppLogger;
}

/** The folders under WORK_DIR whose `pipeline.json` files make the pipelines map. */
export const FACTORY_DIRS: readonly string[] = ['factories.local', 'factories'];

const RESCAN_KEY = '\u0000rescan';
const WORKSPACES_KEY = '\u0000workspaces';
const PIPELINES_KEY = 'pipelines';

/**
 * The disk watchers behind the live feed. `run/` is watched as a tree: every event is
 * classified to a run (debounced per run, its paths folded together), to `workspaces.json`,
 * or to a rescan (a pipeline folder made or gone, or an event with no name). `factories/` and
 * `factories.local/` are watched for `pipeline.json` writes.
 */
export const watchLiveSourcesFactory =
  ({
    watch,
    workDir,
    publisher,
    publishPipelines,
    runDebounceMs = 250,
    pipelinesDebounceMs = 500,
    logger,
  }: WatchLiveSourcesSettings) =>
  (): LiveWatchers => {
    const runs: KeyedDebouncer<string> = debounceByKey(
      runDebounceMs,
      (key: string, paths: readonly string[]): void => {
        if (key === RESCAN_KEY) {
          void publisher.rescan();
          return;
        }
        if (key === WORKSPACES_KEY) {
          void publisher.workspacesChanged();
          return;
        }
        const slash: number = key.indexOf('/');
        void publisher.runChanged({
          folder: key.slice(0, slash),
          runId: key.slice(slash + 1),
          paths,
        });
      },
    );
    const pipelines: KeyedDebouncer<string> = debounceByKey(pipelinesDebounceMs, (): void => {
      void publishPipelines();
    });

    const onRunEvent = (event: WatchEvent): void => {
      const kind: RunPathKind = classifyRunPath(event.path);
      switch (kind.kind) {
        case 'run':
          runs.push(`${kind.folder}/${kind.runId}`, kind.rest);
          return;
        case 'workspaces':
          runs.push(WORKSPACES_KEY, '');
          return;
        case 'folder':
        case 'rescan':
          runs.push(RESCAN_KEY, '');
          return;
        case 'ignore':
          return;
      }
    };

    const onFactoryEvent = (event: WatchEvent): void => {
      if (event.path === '' || isPipelineFile(event.path))
        pipelines.push(PIPELINES_KEY, event.path);
    };

    const handles = [
      watch.watchTree(path.join(workDir, RUN_DIR), onRunEvent),
      ...FACTORY_DIRS.map((dir: string) =>
        watch.watchTree(path.join(workDir, dir), onFactoryEvent),
      ),
    ];
    logger?.info('live watchers started', { workDir });

    return {
      stop: (): void => {
        runs.cancel();
        pipelines.cancel();
        for (const handle of handles) handle.stop();
      },
    };
  };
