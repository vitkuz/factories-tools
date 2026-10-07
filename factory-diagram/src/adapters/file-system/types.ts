export interface FileSystemAdapter {
  readText: (file: string) => string;
  /** Creates the parent folder; returns true when the file's bytes actually changed. */
  writeText: (file: string, text: string) => boolean;
  exists: (target: string) => boolean;
  isDirectory: (target: string) => boolean;
  /** Direct child directory names, sorted. */
  listDirectories: (directory: string) => string[];
}
