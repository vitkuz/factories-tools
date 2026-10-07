/** Hands out RFC 3339 timestamps with nanoseconds; each one is later than the one before. */
export interface Clock {
  now: () => string;
}

/** Builds a clock whose first reading is later than `after` (the run's last recorded timestamp). */
export type ClockFactory = (after?: string) => Clock;
