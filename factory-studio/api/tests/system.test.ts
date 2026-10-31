import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OsProbe, SystemMemoryResponse } from '../src/features/system/system.types.js';
import { fakeHerdr } from './helpers.js';
import { buildTestApp, listen, makeWorkDir, type Listening, type WorkDir } from './work-dir.js';

const GIB = 1024 ** 3;

const fixedOs: OsProbe = {
  totalmem: (): number => 16 * GIB,
  freemem: (): number => 2 * GIB,
  loadavg: (): number[] => [1.5, 1, 0.5],
  cpuCount: (): number => 8,
};

describe('GET /system/memory', () => {
  let work: WorkDir;
  let fromMeminfo: Listening;
  let fallback: Listening;

  beforeAll(async () => {
    work = await makeWorkDir();
    const meminfoPath: string = path.join(work.dir, 'meminfo');
    await writeFile(meminfoPath, 'MemTotal: 1000 kB\nMemFree: 100 kB\nMemAvailable: 250 kB\n');
    fromMeminfo = await listen(
      buildTestApp(work, fakeHerdr().client, { osProbe: fixedOs, meminfoPath }),
    );
    fallback = await listen(
      buildTestApp(work, fakeHerdr().client, {
        osProbe: fixedOs,
        meminfoPath: path.join(work.dir, 'no-meminfo'),
      }),
    );
  });
  afterAll(async () => {
    await Promise.all([fromMeminfo.close(), fallback.close()]);
    await work.cleanup();
  });

  it('answers from MemAvailable, not free memory', async () => {
    const res: Response = await fetch(`${fromMeminfo.origin}/api/v1/system/memory`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await res.json()) as SystemMemoryResponse).toEqual({
      totalBytes: 1024000,
      usedBytes: 768000,
      availableBytes: 256000,
      usedPercent: 75,
      loadAverage: [1.5, 1, 0.5],
      cpuCount: 8,
    });
  });

  it('falls back to os.freemem() when /proc/meminfo cannot be read', async () => {
    const body: SystemMemoryResponse = (await (
      await fetch(`${fallback.origin}/api/v1/system/memory`)
    ).json()) as SystemMemoryResponse;
    expect(body).toMatchObject({
      totalBytes: 16 * GIB,
      usedBytes: 14 * GIB,
      availableBytes: 2 * GIB,
      usedPercent: 88,
    });
  });
});
