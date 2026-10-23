/** A file that is only ever appended to, read in byte ranges. */
export interface TranscriptClient {
  /** Bytes in the file now; `null` when there is no file. */
  size: (file: string) => Promise<number | null>;
  /** Up to `length` bytes from `start`; fewer at the end of the file. */
  readRange: (file: string, start: number, length: number) => Promise<Buffer>;
  /** Names of the files in `dir`, `[]` when there is no such folder. */
  listFiles: (dir: string) => Promise<string[]>;
  /** The parsed JSON in `file`, `null` when it is missing or not JSON. */
  readJson: (file: string) => Promise<unknown>;
}
