import type { FsClient } from '../../../clients/fs/fs.types.js';
import type { AppLogger } from '../../../shared/types.js';
import type { MeminfoValues, OsProbe, SystemMemoryResponse } from '../system.types.js';
import { MEMINFO_PATH, parseMeminfo, toSystemMemory } from '../system.utils.js';

export interface ReadMemorySettings {
  fs: FsClient;
  os: OsProbe;
  /** Default `/proc/meminfo`; a test points it at a fixture. */
  meminfoPath?: string;
  logger?: AppLogger;
}

/**
 * The machine's memory now. `MemAvailable` from `/proc/meminfo` first: `os.freemem()` leaves
 * out the page cache the kernel would hand back, so it makes a busy-looking machine out of an
 * idle one. No readable `MemAvailable` (not Linux, an old kernel): `os.freemem()` it is.
 * Inside WSL2 both read the WSL VM, not the whole Windows machine.
 */
export const readMemoryFactory =
  ({ fs, os, meminfoPath = MEMINFO_PATH, logger }: ReadMemorySettings) =>
  async (): Promise<SystemMemoryResponse> => {
    const meminfo: MeminfoValues | null = await fs
      .readText(meminfoPath)
      .then(parseMeminfo, (error: unknown): null => {
        logger?.debug('meminfo is not readable, falling back to os.freemem()', {
          message: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
    const values: MeminfoValues = meminfo ?? {
      totalBytes: os.totalmem(),
      availableBytes: os.freemem(),
    };
    return { ...toSystemMemory(values), loadAverage: os.loadavg(), cpuCount: os.cpuCount() };
  };
