import type { FileInfo, FsClient } from '../../../clients/fs/fs.types.js';
import type { ResolveDocPathResult } from '../../documents/documents.types.js';
import { isWithin, resolveDocPath } from '../../documents/documents.utils.js';
import type { ResolveRunPathResult } from '../site.types.js';
import { isHiddenName } from '../site.utils.js';

export interface ResolveRunPathSettings {
  fs: FsClient;
}

const OUTSIDE: ResolveRunPathResult = {
  ok: false,
  reason: 'refused',
  status: 403,
  error: 'outside the run folder',
};

/**
 * Checked segments under a run folder, held inside it the strict way: the path is resolved
 * under the run, then both are realpath'd and the target must be the run itself or inside it
 * — a symlink that leads anywhere else is refused. A dot segment is never served (`missing`).
 * `[]` is the run folder itself. The answer carries the real path, so what is read is what
 * was checked.
 */
export const resolveRunPathFactory =
  ({ fs }: ResolveRunPathSettings) =>
  async (runDir: string, segments: readonly string[]): Promise<ResolveRunPathResult> => {
    if (segments.some(isHiddenName)) return { ok: false, reason: 'missing' };
    let target: string = runDir;
    if (segments.length > 0) {
      const resolved: ResolveDocPathResult = resolveDocPath(runDir, segments);
      if (!resolved.ok) return OUTSIDE;
      target = resolved.file;
    }

    const info: FileInfo | null = await fs.stat(target);
    if (info === null || (!info.isFile && !info.isDirectory)) {
      return { ok: false, reason: 'missing' };
    }

    const realRun: string | null = await fs.realpath(runDir);
    const realTarget: string | null = await fs.realpath(target);
    if (realRun === null || realTarget === null) return { ok: false, reason: 'missing' };
    if (realTarget !== realRun && !isWithin(realRun, realTarget)) return OUTSIDE;
    return {
      ok: true,
      file: realTarget,
      kind: info.isDirectory ? 'directory' : 'file',
      size: info.isFile ? info.size : 0,
    };
  };
