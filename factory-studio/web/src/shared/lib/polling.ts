import { useEffect, useState } from 'react';

/*
 * No HTTP polling lives here any more: the data arrives over the socket (see the live hooks).
 * What is left is the render ticker for relative times.
 */

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
