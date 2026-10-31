import type { MemoryTone, SystemMemory } from './system.types';

export const MEMORY_WARNING_PERCENT = 75;
export const MEMORY_DANGER_PERCENT = 90;

export const memoryTone = (usedPercent: number): MemoryTone =>
  usedPercent >= MEMORY_DANGER_PERCENT
    ? 'danger'
    : usedPercent >= MEMORY_WARNING_PERCENT
      ? 'warning'
      : 'normal';

/** Binary gigabytes, one decimal, a whole number without it: 10.1 GB, 16 GB. */
export const formatGb = (bytes: number): string => {
  const gb: number = Math.round((bytes / 1024 ** 3) * 10) / 10;
  return `${Number.isInteger(gb) ? gb.toFixed(0) : gb.toFixed(1)} GB`;
};

/** The tooltip: "Memory used 10.1 GB of 16 GB · 5.9 GB available (WSL memory)". */
export const describeMemory = (memory: SystemMemory): string =>
  `Memory used ${formatGb(memory.usedBytes)} of ${formatGb(memory.totalBytes)} · ${formatGb(
    memory.availableBytes,
  )} available (WSL memory)`;
