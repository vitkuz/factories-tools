import type { DirEntryInfo, FileInfo, FsClient } from '../../../clients/fs/fs.types.js';
import type {
  DirEntry,
  DocEtag,
  DocumentAnswer,
  ParsedDocPath,
  ResolveDocPathResult,
} from '../documents.types.js';
import {
  contentTypeFor,
  docPathOf,
  etagOf,
  isHashable,
  resolveDocPath,
  sortEntries,
} from '../documents.utils.js';

export interface ReadDocumentSettings {
  fs: FsClient;
}

const toDirEntry = (entry: DirEntryInfo): DirEntry => ({
  name: entry.name,
  type: entry.isDirectory ? 'directory' : 'file',
  size: entry.isFile ? entry.size : 0,
});

/**
 * One checked path under one base: a file to stream, a folder listing (dotfiles hidden), a
 * `missing` notice for what no step has written yet, or a refusal. Never throws for a path.
 * A text file small enough to edit also carries its ETag (the hash a guarded write checks);
 * the body still streams from a second read, so images and big files are never buffered.
 */
export const readDocumentFactory =
  ({ fs }: ReadDocumentSettings) =>
  async (base: string, parsed: ParsedDocPath): Promise<DocumentAnswer> => {
    const resolved: ResolveDocPathResult = resolveDocPath(base, parsed.segments);
    if (!resolved.ok) return { kind: 'refused', status: resolved.status, error: resolved.error };

    const docPath: string = docPathOf(parsed);
    const info: FileInfo | null = await fs.stat(resolved.file);
    if (info === null) return { kind: 'missing', path: docPath };

    if (info.isDirectory) {
      const entries: DirEntryInfo[] = await fs.listDir(resolved.file);
      const visible: DirEntry[] = entries
        .filter(
          (entry: DirEntryInfo): boolean =>
            !entry.name.startsWith('.') && (entry.isFile || entry.isDirectory),
        )
        .map(toDirEntry);
      return { kind: 'directory', path: docPath, entries: sortEntries(visible) };
    }

    if (info.isFile && !parsed.directory) {
      const etag: DocEtag | undefined = isHashable(resolved.file, info.size)
        ? etagOf(await fs.readText(resolved.file))
        : undefined;
      return {
        kind: 'file',
        file: resolved.file,
        size: info.size,
        contentType: contentTypeFor(resolved.file),
        open: () => fs.openRead(resolved.file),
        ...(etag === undefined ? {} : { etag }),
      };
    }
    return { kind: 'not-found' };
  };
