// Learned from factories-tools/run-state/src/clients/clock/client.ts
import { formatNanos, parseNanos } from './clock.utils.js';
import type { Clock } from './types.js';

/**
 * The wall clock at nanosecond grain (Date.now() plus the monotonic hrtime since start). Strictly
 * increasing: a reading that would not move forward is the last one plus 1 ns. `after` is the last
 * timestamp the run recorded, so a resumed run never writes one earlier than the file already holds.
 *
 * The only mutable value among the clients lives here, in this closure: that is what a clock is.
 */
export const createSystemClock = (after?: string): Clock => {
  const hrBase: bigint = process.hrtime.bigint();
  const epochNs: bigint = BigInt(Date.now()) * 1_000_000n;
  let last: bigint = (after === undefined ? undefined : parseNanos(after)) ?? 0n;
  return {
    now: (): string => {
      const candidate: bigint = epochNs + (process.hrtime.bigint() - hrBase);
      last = candidate > last ? candidate : last + 1n;
      return formatNanos(last);
    },
  };
};

/** Each reading one millisecond after the one before, from `start` (or just after `after`). Tests. */
export const createSteppingClock =
  (start: string) =>
  (after?: string): Clock => {
    let last: bigint = (parseNanos(after ?? start) ?? 0n) - (after === undefined ? 1_000_000n : 0n);
    return {
      now: (): string => {
        last += 1_000_000n;
        return formatNanos(last);
      },
    };
  };
