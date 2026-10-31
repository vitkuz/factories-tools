import type { Readable } from 'node:stream';
import type { z } from 'zod';
import type { ZipEntry } from '../../clients/zip/zip.types.js';
import type { DirEntry } from '../documents/documents.types.js';
import type { siteParamsSchema } from './site.schema.js';

export type SiteParams = z.infer<typeof siteParamsSchema>;

/** What E17 answers for one checked path under one run. */
export type SiteAnswer =
  | { kind: 'file'; file: string; size: number; contentType: string; open: () => Readable }
  /** A folder without `index.html`: the listing page. `path` is `''` at the run root, else `a/b/`. */
  | { kind: 'listing'; path: string; entries: DirEntry[] }
  /** A folder named without its trailing `/`: the controller sends the client to the same URL + `/`. */
  | { kind: 'redirect' }
  | { kind: 'not-found' }
  | { kind: 'refused'; status: 400 | 403; error: string };

export type ReadSiteResult =
  { ok: true; answer: SiteAnswer } | { ok: false; reason: 'run-not-found' };

/** One path under a run, once symlinks are followed: `file` is the real path. */
export type ResolveRunPathResult =
  | { ok: true; file: string; kind: 'file' | 'directory'; size: number }
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'refused'; status: 400 | 403; error: string };

export interface ZipLimits {
  maxEntries: number;
  maxBytes: number;
}

export type WalkFolderResult =
  | { ok: true; entries: ZipEntry[]; bytes: number }
  | { ok: false; status: 413; error: string; details: unknown };

export type ZipPlan =
  | { ok: true; fileName: string; entries: ZipEntry[]; bytes: number }
  | { ok: false; status: 400 | 403 | 404 | 413; error: string; details?: unknown };

export type ZipFolderResult = { ok: true; plan: ZipPlan } | { ok: false; reason: 'run-not-found' };

export interface SiteServices {
  /** From runs: the absolute run folder, or null. */
  locateRunDir: (pipelineId: string, runId: string) => Promise<string | null>;
  /** Segments under the run dir, resolved and held inside it once symlinks are followed. */
  resolveRunPath: (runDir: string, segments: readonly string[]) => Promise<ResolveRunPathResult>;
  /** Every regular file under `dir` (dotfiles and symlinks skipped), capped by `limits`. */
  walkFolder: (dir: string, limits: ZipLimits) => Promise<WalkFolderResult>;
}

export interface SiteUsecases {
  /**
   * `rawPath` is the URL remainder after `/site/<p>/<r>/` (`''` for the run root); `null` when
   * the URL stops at the run id without its `/`.
   */
  readSite: (pipelineId: string, runId: string, rawPath: string | null) => Promise<ReadSiteResult>;
  zipFolder: (pipelineId: string, runId: string, rawPath: string) => Promise<ZipFolderResult>;
}
