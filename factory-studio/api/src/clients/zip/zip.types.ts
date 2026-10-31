import type { Readable } from 'node:stream';
import type { AppLogger } from '../../shared/types.js';

/** One file of a zip: where it is on disk, and the name it gets in the archive. */
export interface ZipEntry {
  file: string;
  /** Relative to the zipped folder, `/`-separated. */
  name: string;
  size: number;
}

export interface ZipClientSettings {
  logger?: AppLogger;
}

/** The one place that writes zip archives. Every entry it receives was already checked. */
export interface ZipClient {
  /** A zip of `entries`, deflated, as a stream that ends after the last entry is written. */
  stream: (entries: readonly ZipEntry[]) => Readable;
}
