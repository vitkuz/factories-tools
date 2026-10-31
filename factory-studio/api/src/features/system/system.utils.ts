import type { MeminfoValues, SystemMemory } from './system.types.js';

/** Where Linux (and WSL) says how much memory a new process could still get. */
export const MEMINFO_PATH = '/proc/meminfo';

const KIB = 1024;

/** `MemAvailable:   5934120 kB` -> 5934120 * 1024; `null` when the line is absent or odd. */
const meminfoBytes = (text: string, key: string): number | null => {
  const match: RegExpMatchArray | null = text.match(
    new RegExp(`^${key}:\\s+(\\d+)(?:\\s+kB)?\\s*$`, 'm'),
  );
  return match?.[1] === undefined ? null : Number(match[1]) * KIB;
};

/**
 * `MemTotal` and `MemAvailable` from `/proc/meminfo`. `null` when either is missing (an old
 * kernel without `MemAvailable`, or not Linux at all), so the caller falls back to `os`.
 */
export const parseMeminfo = (text: string): MeminfoValues | null => {
  const totalBytes: number | null = meminfoBytes(text, 'MemTotal');
  const availableBytes: number | null = meminfoBytes(text, 'MemAvailable');
  if (totalBytes === null || availableBytes === null || totalBytes <= 0) return null;
  return { totalBytes, availableBytes };
};

/** Used and percent from total and available, with available clamped into 0..total. */
export const toSystemMemory = ({ totalBytes, availableBytes }: MeminfoValues): SystemMemory => {
  const available: number = Math.min(Math.max(availableBytes, 0), totalBytes);
  const usedBytes: number = totalBytes - available;
  return {
    totalBytes,
    usedBytes,
    availableBytes: available,
    usedPercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0,
  };
};
