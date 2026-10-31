import path from 'node:path';
import type { DirEntryInfo, FsClient } from '../../../clients/fs/fs.types.js';
import type { ZipEntry } from '../../../clients/zip/zip.types.js';
import type { WalkFolderResult, ZipLimits } from '../site.types.js';
import { isHiddenName } from '../site.utils.js';

export interface WalkFolderSettings {
  fs: FsClient;
}

interface Walk {
  entries: ZipEntry[];
  bytes: number;
}

const tooLarge = (walk: Walk, limits: ZipLimits): WalkFolderResult => ({
  ok: false,
  status: 413,
  error: 'folder too large to zip',
  details: {
    entries: walk.entries.length,
    bytes: walk.bytes,
    maxEntries: limits.maxEntries,
    maxBytes: limits.maxBytes,
  },
});

const overLimits = (walk: Walk, limits: ZipLimits): boolean =>
  walk.entries.length > limits.maxEntries || walk.bytes > limits.maxBytes;

/**
 * Every regular file under `dir`, depth first, named relative to it with `/`. Dotfiles and
 * dot-folders are skipped; a symlink is neither a file nor a folder to `listDir`, so it is
 * never followed. The walk stops as soon as a cap is passed, before a byte of the zip is sent.
 */
export const walkFolderFactory =
  ({ fs }: WalkFolderSettings) =>
  async (dir: string, limits: ZipLimits): Promise<WalkFolderResult> => {
    const walk: Walk = { entries: [], bytes: 0 };
    const visit = async (folder: string, prefix: string): Promise<boolean> => {
      const listed: DirEntryInfo[] = await fs.listDir(folder);
      const sorted: DirEntryInfo[] = [...listed].sort((a: DirEntryInfo, b: DirEntryInfo): number =>
        a.name.localeCompare(b.name),
      );
      for (const entry of sorted) {
        if (isHiddenName(entry.name)) continue;
        const file: string = path.join(folder, entry.name);
        const name: string = `${prefix}${entry.name}`;
        if (entry.isFile) {
          walk.entries.push({ file, name, size: entry.size });
          walk.bytes += entry.size;
          if (overLimits(walk, limits)) return false;
        } else if (entry.isDirectory && !(await visit(file, `${name}/`))) {
          return false;
        }
      }
      return true;
    };
    const complete: boolean = await visit(dir, '');
    return complete
      ? { ok: true, entries: walk.entries, bytes: walk.bytes }
      : tooLarge(walk, limits);
  };
