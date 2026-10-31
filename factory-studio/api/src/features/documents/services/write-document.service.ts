import type { FileInfo, FsClient } from '../../../clients/fs/fs.types.js';
import type {
  DocEtag,
  ParsedDocPath,
  ResolveDocPathResult,
  WriteAnswer,
  WriteGuard,
} from '../documents.types.js';
import { etagOf, isEditableFile, isRecorderFile, resolveDocPath } from '../documents.utils.js';

export interface WriteDocumentSettings {
  fs: FsClient;
}

/**
 * Writes one text document under one base, creating the folders it needs. Only text files,
 * only inside the base, never over a folder, never over the recorder's own `state.json` or
 * `cost.json`. The size limit is enforced by the body parser before the text gets here.
 * The guard (from `If-Match` / `If-None-Match`) refuses with 409 a write made against bytes
 * that are no longer on disk; with no guard the write goes through as before.
 */
export const writeDocumentFactory =
  ({ fs }: WriteDocumentSettings) =>
  async (
    base: string,
    parsed: ParsedDocPath,
    text: string,
    guard: WriteGuard = { kind: 'any' },
  ): Promise<WriteAnswer> => {
    if (parsed.directory)
      return { kind: 'refused', status: 400, error: 'a folder cannot be written' };

    if (isRecorderFile(parsed.segments)) {
      const name: string = parsed.segments[parsed.segments.length - 1] ?? '';
      return { kind: 'refused', status: 400, error: `${name} belongs to the recorder` };
    }

    const resolved: ResolveDocPathResult = resolveDocPath(base, parsed.segments);
    if (!resolved.ok) return { kind: 'refused', status: resolved.status, error: resolved.error };

    if (!isEditableFile(resolved.file)) {
      return { kind: 'refused', status: 415, error: 'only text documents can be edited' };
    }

    const existing: FileInfo | null = await fs.stat(resolved.file);
    if (existing !== null && !existing.isFile) {
      return { kind: 'refused', status: 400, error: 'not a file' };
    }
    // Check, then rename: not one atomic step, but there is one API process and the window is
    // a hash of at most 2 MB — good enough to catch an edit made since the editor loaded.
    if (guard.kind === 'absent' && existing !== null) {
      return { kind: 'refused', status: 409, error: 'the file already exists' };
    }
    if (guard.kind === 'match') {
      if (existing === null) {
        return { kind: 'refused', status: 409, error: 'the file is gone from disk' };
      }
      const current: DocEtag = etagOf(await fs.readText(resolved.file));
      if (current !== guard.etag) {
        return {
          kind: 'refused',
          status: 409,
          error: 'the file changed on disk since it was loaded',
        };
      }
    }

    const bytes: number = await fs.writeTextAtomic(resolved.file, text);
    return { kind: 'saved', bytes, etag: etagOf(text) };
  };
