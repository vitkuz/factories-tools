import path from 'node:path';
import type { FileInfo, FsClient } from '../../../clients/fs/fs.types.js';
import type { AppLogger } from '../../../shared/types.js';
import type { RunRecord } from '../../runs/runs.types.js';
import { RUN_DIR } from '../../runs/runs.utils.js';
import type { ActiveRunTracker, RunKey, RunSweeper } from '../live.types.js';
import { isActiveRunStatus } from '../live.utils.js';

const keyOf = ({ folder, runId }: RunKey): string => `${folder}/${runId}`;

/**
 * The runs that may still be written to: their last known status is one the recorder moves on
 * from (IDLE, RUNNING, PAUSED). Fed by every record the live feed reads; a run read as finished
 * or gone leaves the set. In memory, replaced on every change.
 */
export const createActiveRunTracker = (): ActiveRunTracker => {
  let active: ReadonlyMap<string, RunKey> = new Map();
  const note = (folder: string, runId: string, status: string | null | undefined): void => {
    const key: string = keyOf({ folder, runId });
    const next: Map<string, RunKey> = new Map(active);
    if (isActiveRunStatus(status)) next.set(key, { folder, runId });
    else next.delete(key);
    active = next;
  };
  return {
    note,
    noteRecords: (records: readonly RunRecord[]): void => {
      for (const record of records) {
        const folder: string = record.dir.split('/')[1] ?? record.pipelineId;
        note(folder, record.runId, record.state?.status ?? (record.hasState ? null : 'IDLE'));
      }
    },
    forget: (folder: string, runId: string): void => note(folder, runId, null),
    active: (): RunKey[] => [...active.values()],
  };
};

export interface RunSweepSettings {
  fs: Pick<FsClient, 'stat'>;
  workDir: string;
  tracker: Pick<ActiveRunTracker, 'active'>;
  /** A run whose record files moved since the last look; `paths` names them. */
  onChanged: (key: RunKey, paths: string[]) => void;
  intervalMs?: number;
  logger?: AppLogger;
}

/** The files of a run folder that make its record, in the order they are swept. */
const RECORD_FILES: readonly string[] = ['state.json', 'cost.json'];

const fingerprint = (info: FileInfo | null): string =>
  info === null ? 'missing' : `${info.mtimeMs}:${info.size}`;

/**
 * The safety net under the watcher: every `intervalMs` (5 s), the record files of every active
 * run are `stat`ed and a run whose `state.json` or `cost.json` changed mtime or size since the
 * last sweep is reported. A run seen for the first time is only remembered. Server side only;
 * nothing of this reaches the browser as a request.
 */
export const createRunSweeper = ({
  fs,
  workDir,
  tracker,
  onChanged,
  intervalMs = 5000,
  logger,
}: RunSweepSettings): RunSweeper => {
  let seen: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map();
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | null = null;

  const sweepOne = async (key: RunKey): Promise<[string, ReadonlyMap<string, string>]> => {
    const dir: string = path.join(workDir, RUN_DIR, key.folder, key.runId);
    const prints: [string, string][] = await Promise.all(
      RECORD_FILES.map(async (name: string): Promise<[string, string]> => [
        name,
        fingerprint(await fs.stat(path.join(dir, name))),
      ]),
    );
    return [keyOf(key), new Map(prints)];
  };

  const tick = async (): Promise<void> => {
    if (running) return running;
    running = (async (): Promise<void> => {
      const active: RunKey[] = tracker.active();
      const next: Map<string, ReadonlyMap<string, string>> = new Map();
      for (const key of active) {
        const [id, prints]: [string, ReadonlyMap<string, string>] = await sweepOne(key);
        next.set(id, prints);
        const before: ReadonlyMap<string, string> | undefined = seen.get(id);
        if (before === undefined) continue;
        const changed: string[] = [...prints].flatMap(
          ([name, print]: [string, string]): string[] => (before.get(name) === print ? [] : [name]),
        );
        if (changed.length > 0) {
          logger?.debug('sweep: run record moved', { run: id, changed });
          onChanged(key, changed);
        }
      }
      seen = next;
    })()
      .catch((error: unknown): void => {
        logger?.warn('sweep failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally((): void => {
        running = null;
      });
    return running;
  };

  return {
    tick,
    start: (): void => {
      if (timer) return;
      timer = setInterval((): void => void tick(), intervalMs);
      timer.unref();
    },
    stop: (): void => {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
};
