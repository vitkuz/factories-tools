export interface FileSystemClient {
  readText: (file: string) => string;
  exists: (target: string) => boolean;
  isDirectory: (target: string) => boolean;
  /** Direct child directory names, sorted. */
  listDirectories: (directory: string) => string[];
  /** Create the folder and its parents; nothing happens when it exists. */
  makeDirectory: (directory: string) => void;
  /** Write to a temp file beside the target, then rename it over: a reader never sees half a file. */
  writeTextAtomic: (file: string, text: string) => void;
  /** Plain write, parents created. */
  writeText: (file: string, text: string) => void;
  /** Append one line (a newline is added), parents created. */
  appendLine: (file: string, line: string) => void;
  /** Absolute pattern in, absolute files out, sorted so every run lists them the same way. */
  glob: (pattern: string) => string[];
}
