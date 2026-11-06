import type { AppLogger } from '../../shared/types.js';

/** One change under a watched tree: the path relative to the tree root, `/` separators. */
export interface WatchEvent {
  /** `rename` (created, removed, renamed, a temp file moved into place) or `change` (bytes written). */
  type: 'rename' | 'change';
  /** Relative to the watched root; `''` when the watcher cannot say which entry (then rescan). */
  path: string;
}

export interface WatchClientSettings {
  logger?: AppLogger;
  /** How long to wait before watching again after the watcher itself failed. */
  retryMs?: number;
}

export interface TreeWatch {
  stop: () => void;
}

export interface WatchClient {
  /**
   * Watches `dir` and everything under it. A `dir` that does not exist yet is waited for
   * through its parent and watched once it appears. `onEvent` never sees an error: failures
   * are logged and the watch is retried.
   */
  watchTree: (dir: string, onEvent: (event: WatchEvent) => void) => TreeWatch;
}
