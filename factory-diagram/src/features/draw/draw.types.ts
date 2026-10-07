import type { OutputFormat, RenderOptions } from '../render/render.types.js';

export interface DrawRequest {
  /** A factory id, a folder or a pipeline.json; ignored when `all` is set. */
  pipeline?: string;
  all: boolean;
  rootPath: string;
  /** `--out`: a folder, or (single pipeline only) the exact file to write. */
  out?: string;
  format: OutputFormat;
  options: RenderOptions;
  /** Fail on warnings, not only on errors. */
  strict: boolean;
}

export interface DrawnFile {
  id: string;
  file: string;
  /** False when the bytes on disk already matched. */
  changed: boolean;
  warnings: string[];
}

export interface DrawReport {
  files: DrawnFile[];
  /** `index.md` written beside the diagrams of an `--all` run. */
  index?: string;
}
