import type { AppLogger } from '../../../shared/types.js';
import type { SystemMemoryResponse } from '../../system/system.types.js';
import type { MemoryTicker, SubscriptionRegistry } from '../live.types.js';

export interface MemoryTickerSettings {
  readMemory: () => Promise<SystemMemoryResponse>;
  registry: Pick<SubscriptionRegistry, 'publish' | 'count'>;
  intervalMs?: number;
  logger?: AppLogger;
}

/**
 * The one server-side interval the live feed adds: the machine's memory every `intervalMs`
 * (5 s), read and published only while a client subscribes to `system`. Replaces the browser's
 * own 5 s poll of GET /system/memory.
 */
export const createMemoryTicker = ({
  readMemory,
  registry,
  intervalMs = 5000,
  logger,
}: MemoryTickerSettings): MemoryTicker => {
  let timer: NodeJS.Timeout | undefined;

  const tick = async (): Promise<void> => {
    if (registry.count('system') === 0) return;
    try {
      const memory: SystemMemoryResponse = await readMemory();
      registry.publish('system', { type: 'system.memory', ...memory });
    } catch (error: unknown) {
      logger?.warn('memory reading failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
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
