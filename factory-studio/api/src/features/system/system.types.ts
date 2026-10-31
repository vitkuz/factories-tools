/** Memory as a person reads it: what is in use and what is still there to take. */
export interface SystemMemory {
  totalBytes: number;
  /** `totalBytes - availableBytes`: page cache the kernel would give back is not "used". */
  usedBytes: number;
  availableBytes: number;
  /** Rounded to an integer, 0..100. */
  usedPercent: number;
}

/** `/proc/meminfo` boiled down to the two lines that matter, in bytes. */
export interface MeminfoValues {
  totalBytes: number;
  availableBytes: number;
}

/** What `GET /system/memory` answers: the memory, plus the CPU load while we are at it. */
export interface SystemMemoryResponse extends SystemMemory {
  /** 1, 5 and 15 minute load averages, as `os.loadavg()` gives them. */
  loadAverage: number[];
  cpuCount: number;
}

/** The slice of `node:os` the service reads; a test hands in fixed numbers. */
export interface OsProbe {
  totalmem: () => number;
  freemem: () => number;
  loadavg: () => number[];
  cpuCount: () => number;
}

/** What `server.ts` hands the system routes. */
export interface SystemUsecases {
  readMemory: () => Promise<SystemMemoryResponse>;
}
