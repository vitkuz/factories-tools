import { describe, expect, it } from 'vitest';
import { systemMemorySchema } from '../src/features/system/system.schema';
import type { SystemMemory } from '../src/features/system/system.types';
import { describeMemory, formatGb, memoryTone } from '../src/features/system/system.utils';

const GIB = 1024 ** 3;

describe('memoryTone', () => {
  it.each([
    [0, 'normal'],
    [74, 'normal'],
    [75, 'warning'],
    [89, 'warning'],
    [90, 'danger'],
    [100, 'danger'],
  ])('%i%% -> %s', (percent: number, tone: string) => {
    expect(memoryTone(percent)).toBe(tone);
  });
});

describe('formatGb', () => {
  it('one decimal, none on a whole number', () => {
    expect(formatGb(16 * GIB)).toBe('16 GB');
    expect(formatGb(10.14 * GIB)).toBe('10.1 GB');
    expect(formatGb(0)).toBe('0 GB');
  });
});

describe('describeMemory', () => {
  it('says used, total and available, and that it is WSL memory', () => {
    const memory: SystemMemory = {
      totalBytes: 16 * GIB,
      usedBytes: 10.1 * GIB,
      availableBytes: 5.9 * GIB,
      usedPercent: 63,
      loadAverage: [0.5, 0.4, 0.3],
      cpuCount: 8,
    };
    expect(describeMemory(memory)).toBe(
      'Memory used 10.1 GB of 16 GB · 5.9 GB available (WSL memory)',
    );
  });
});

describe('systemMemorySchema', () => {
  it('refuses a percent out of range', () => {
    expect(
      systemMemorySchema.safeParse({
        totalBytes: 1,
        usedBytes: 1,
        availableBytes: 0,
        usedPercent: 120,
        loadAverage: [],
        cpuCount: 1,
      }).success,
    ).toBe(false);
  });
});
