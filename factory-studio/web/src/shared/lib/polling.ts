import { useEffect, useState } from 'react';

/**
 * Calls `tick` every `intervalMs` while the page is visible; fires once immediately
 * when the page becomes visible again. `intervalMs` null disables polling.
 */
export const usePolling = (tick: () => void, intervalMs: number | null): void => {
  useEffect(() => {
    if (intervalMs == null) return;
    let timer: number | undefined;
    const schedule = (): void => {
      window.clearInterval(timer);
      if (!document.hidden) timer = window.setInterval(tick, intervalMs);
    };
    const onVisibility = (): void => {
      if (!document.hidden) tick();
      schedule();
    };
    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [tick, intervalMs]);
};

/** A `Date.now()` that re-renders every `everyMs` — for "updated N s ago" text. `null` = no ticking. */
export const useNow = (everyMs: number | null): number => {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (everyMs == null) return;
    setNow(Date.now());
    const timer: number = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
};
