import { describe, expect, it } from 'vitest';
import { parseMeminfo, toSystemMemory } from '../src/features/system/system.utils.js';

const MEMINFO = [
  'MemTotal:       16303308 kB',
  'MemFree:         1203116 kB',
  'MemAvailable:    6118220 kB',
  'Buffers:          212344 kB',
  'Cached:          5023188 kB',
  'SwapTotal:       4194304 kB',
  '',
].join('\n');

describe('parseMeminfo', () => {
  it('reads MemTotal and MemAvailable in bytes, not MemFree', () => {
    expect(parseMeminfo(MEMINFO)).toEqual({
      totalBytes: 16303308 * 1024,
      availableBytes: 6118220 * 1024,
    });
  });

  it('is null without MemAvailable (an old kernel)', () => {
    expect(parseMeminfo('MemTotal: 1000 kB\nMemFree: 200 kB\n')).toBeNull();
  });

  it('is null without MemTotal, on empty text and on a zero total', () => {
    expect(parseMeminfo('MemAvailable: 200 kB\n')).toBeNull();
    expect(parseMeminfo('')).toBeNull();
    expect(parseMeminfo('MemTotal: 0 kB\nMemAvailable: 0 kB\n')).toBeNull();
  });

  it('does not take a longer key that starts the same', () => {
    expect(parseMeminfo('MemTotalX: 9 kB\nMemTotal: 10 kB\nMemAvailable: 5 kB\n')).toEqual({
      totalBytes: 10240,
      availableBytes: 5120,
    });
  });
});

describe('toSystemMemory', () => {
  it('used is total minus available; percent is rounded', () => {
    expect(toSystemMemory({ totalBytes: 1000, availableBytes: 374 })).toEqual({
      totalBytes: 1000,
      usedBytes: 626,
      availableBytes: 374,
      usedPercent: 63,
    });
  });

  it('clamps available into 0..total', () => {
    expect(toSystemMemory({ totalBytes: 1000, availableBytes: 1500 }).usedPercent).toBe(0);
    expect(toSystemMemory({ totalBytes: 1000, availableBytes: -5 })).toMatchObject({
      usedBytes: 1000,
      availableBytes: 0,
      usedPercent: 100,
    });
  });

  it('a zero total is 0%, never NaN', () => {
    expect(toSystemMemory({ totalBytes: 0, availableBytes: 0 }).usedPercent).toBe(0);
  });
});
