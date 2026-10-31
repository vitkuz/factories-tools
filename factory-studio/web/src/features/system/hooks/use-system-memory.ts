import { useCallback, useEffect, useRef, useState } from 'react';
import { readSystemMemory } from '../../../adapters/http/studio-api.adapter';
import { usePolling } from '../../../shared/lib/polling';
import type { SystemMemory } from '../system.types';

const POLL_MS = 5000;

/**
 * The memory reading, refreshed every 5 s while the page is visible. `null` until the first
 * answer, and again whenever a request fails: the meter then says "—" rather than a stale
 * number. A slow answer never overwrites a newer one (the previous request is aborted).
 */
export const useSystemMemory = (): SystemMemory | null => {
  const [memory, setMemory] = useState<SystemMemory | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const tick = useCallback((): void => {
    inFlight.current?.abort();
    const controller: AbortController = new AbortController();
    inFlight.current = controller;
    readSystemMemory(controller.signal).then(
      (next: SystemMemory): void => setMemory(next),
      (): void => {
        if (!controller.signal.aborted) setMemory(null);
      },
    );
  }, []);

  useEffect(() => {
    tick();
    return () => inFlight.current?.abort();
  }, [tick]);
  usePolling(tick, POLL_MS);
  return memory;
};
