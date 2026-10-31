import type { ParseDocPathResult } from '../../documents/documents.types.js';
import { parseDocPath } from '../../documents/documents.utils.js';
import type {
  ResolveRunPathResult,
  SiteServices,
  WalkFolderResult,
  ZipFolderResult,
  ZipLimits,
  ZipPlan,
} from '../site.types.js';
import { MAX_ZIP_BYTES, MAX_ZIP_ENTRIES, zipFileName } from '../site.utils.js';

export interface ZipFolderSettings extends Pick<
  SiteServices,
  'locateRunDir' | 'resolveRunPath' | 'walkFolder'
> {
  /** Default: `MAX_ZIP_ENTRIES` files and `MAX_ZIP_BYTES` of input. */
  limits?: ZipLimits;
}

const DEFAULT_LIMITS: ZipLimits = { maxEntries: MAX_ZIP_ENTRIES, maxBytes: MAX_ZIP_BYTES };

/**
 * The plan of a folder's zip: the checked folder (held inside the run once symlinks are
 * followed), every file under it and the download's name, or why there is none. The whole
 * tree is walked and capped here, so a refusal is a clean JSON error, never a cut stream.
 */
export const zipFolderFactory =
  ({ locateRunDir, resolveRunPath, walkFolder, limits = DEFAULT_LIMITS }: ZipFolderSettings) =>
  async (pipelineId: string, runId: string, rawPath: string): Promise<ZipFolderResult> => {
    let segments: string[] = [];
    if (rawPath !== '') {
      const parsed: ParseDocPathResult = parseDocPath(rawPath);
      if (!parsed.ok) {
        return { ok: true, plan: { ok: false, status: parsed.status, error: parsed.error } };
      }
      segments = parsed.parsed.segments;
    }

    const runDir: string | null = await locateRunDir(pipelineId, runId);
    if (runDir === null) return { ok: false, reason: 'run-not-found' };

    const plan = (value: ZipPlan): ZipFolderResult => ({ ok: true, plan: value });
    const target: ResolveRunPathResult = await resolveRunPath(runDir, segments);
    if (!target.ok) {
      return plan(
        target.reason === 'missing'
          ? { ok: false, status: 404, error: 'not found' }
          : { ok: false, status: target.status, error: target.error },
      );
    }
    if (target.kind === 'file') return plan({ ok: false, status: 400, error: 'not a folder' });

    const walk: WalkFolderResult = await walkFolder(target.file, limits);
    if (!walk.ok) return plan(walk);
    return plan({
      ok: true,
      fileName: zipFileName(runId, segments),
      entries: walk.entries,
      bytes: walk.bytes,
    });
  };
