export interface DebounceTimers {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
  /** The clock the max wait is measured on. */
  now: () => number;
}

export interface KeyedDebouncer<T> {
  /** Note one event for `key`; the flush for that key is (re)scheduled `ms` from now. */
  push: (key: string, item: T) => void;
  /** Flushes every pending key now and stops every timer. */
  flushAll: () => void;
  /** Drops everything pending without flushing. */
  cancel: () => void;
  /** Keys with a flush scheduled. */
  pending: () => string[];
}

interface Waiting<T> {
  items: readonly T[];
  handle: unknown;
  /** When the first push of this burst happened. */
  since: number;
}

const realTimers: DebounceTimers = {
  set: (callback: () => void, ms: number): unknown => {
    const timer: NodeJS.Timeout = setTimeout(callback, ms);
    timer.unref();
    return timer;
  },
  clear: (handle: unknown): void => clearTimeout(handle as NodeJS.Timeout),
  now: (): number => Date.now(),
};

/**
 * A trailing debounce per key: the items pushed for one key while its timer runs are handed to
 * `flush` together, once, `ms` after the last push — but never later than `maxWaitMs` after
 * the first, so a folder written to without pause still reports every `maxWaitMs`. A recorder
 * write is a temp file, a rename and often a second write within milliseconds; this folds them
 * into one event. The timers are injectable so a test can drive them by hand.
 */
export const debounceByKey = <T>(
  ms: number,
  flush: (key: string, items: readonly T[]) => void,
  timers: DebounceTimers = realTimers,
  maxWaitMs: number = ms * 4,
): KeyedDebouncer<T> => {
  let waiting: ReadonlyMap<string, Waiting<T>> = new Map();

  const take = (key: string): Waiting<T> | undefined => {
    const entry: Waiting<T> | undefined = waiting.get(key);
    if (entry === undefined) return undefined;
    timers.clear(entry.handle);
    const next: Map<string, Waiting<T>> = new Map(waiting);
    next.delete(key);
    waiting = next;
    return entry;
  };

  const fire = (key: string): void => {
    const entry: Waiting<T> | undefined = take(key);
    if (entry !== undefined && entry.items.length > 0) flush(key, entry.items);
  };

  return {
    push: (key: string, item: T): void => {
      const now: number = timers.now();
      const previous: Waiting<T> | undefined = take(key);
      const since: number = previous?.since ?? now;
      const items: readonly T[] = [...(previous?.items ?? []), item];
      const wait: number = Math.max(0, Math.min(ms, since + maxWaitMs - now));
      const handle: unknown = timers.set((): void => fire(key), wait);
      waiting = new Map([...waiting, [key, { items, handle, since }]]);
    },
    flushAll: (): void => {
      for (const key of [...waiting.keys()]) fire(key);
    },
    cancel: (): void => {
      for (const key of [...waiting.keys()]) take(key);
    },
    pending: (): string[] => [...waiting.keys()],
  };
};
