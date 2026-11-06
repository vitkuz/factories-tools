import type { z } from 'zod';
import type { WsClient } from '../../shared/ws/ws.types.js';
import type { RunRecord } from '../runs/runs.types.js';
import type {
  liveClientMessageSchema,
  liveServerMessageSchema,
  liveTopicSchema,
} from './live.schema.js';

export type LiveTopic = z.infer<typeof liveTopicSchema>;
export type LiveClientMessage = z.infer<typeof liveClientMessageSchema>;
export type LiveServerMessage = z.infer<typeof liveServerMessageSchema>;

/** What a path under `run/` names. */
export type RunPathKind =
  /** Something in one run folder: `rest` is the path inside it (`''` for the folder itself). */
  | { kind: 'run'; folder: string; runId: string; rest: string }
  /** `run/workspaces.json`. */
  | { kind: 'workspaces' }
  /** A pipeline folder itself (`run/<folder>`), made or removed: every run under it may have moved. */
  | { kind: 'folder'; folder: string }
  /** Not known which entry changed: read everything again. */
  | { kind: 'rescan' }
  /** `.trash`, dotfiles, editor temp files: nothing to tell. */
  | { kind: 'ignore' };

/** Who listens to which topic, and a way to reach them. */
export interface SubscriptionRegistry {
  subscribe: (client: WsClient, topics: readonly LiveTopic[]) => void;
  unsubscribe: (clientId: string, topics: readonly LiveTopic[]) => void;
  /** The socket closed: every topic it had is over. */
  drop: (clientId: string) => void;
  publish: (topic: LiveTopic, message: LiveServerMessage) => void;
  count: (topic: LiveTopic) => number;
}

/** One run folder: where it is filed and its id. */
export interface RunKey {
  folder: string;
  runId: string;
}

/** The runs that may still be written to, as the live feed last read them. */
export interface ActiveRunTracker {
  note: (folder: string, runId: string, status: string | null | undefined) => void;
  /** Every record of a list read (a snapshot, a rescan). */
  noteRecords: (records: readonly RunRecord[]) => void;
  forget: (folder: string, runId: string) => void;
  active: () => RunKey[];
}

/** The mtime sweep over the active runs' record files: the safety net under the watcher. */
export interface RunSweeper {
  start: () => void;
  stop: () => void;
  /** One sweep, awaited. */
  tick: () => Promise<void>;
}

export interface MemoryTicker {
  start: () => void;
  stop: () => void;
  /** One reading, awaited: published when someone listens. */
  tick: () => Promise<void>;
}

/** Sends the opening frame of one topic to one client. */
export type SendSnapshot = (topic: LiveTopic, client: WsClient) => Promise<void>;

/** A debounced change to one run folder: which paths under it moved since the last push. */
export interface RunChange {
  folder: string;
  runId: string;
  paths: readonly string[];
}

/** Starts the disk watchers that feed the registry; `stop` closes them. */
export interface LiveWatchers {
  stop: () => void;
}
