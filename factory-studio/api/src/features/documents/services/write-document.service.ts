import type { FileInfo, FsClient } from '../../../clients/fs/fs.types.js';
import type { ParsedDocPath, ResolveDocPathResult, WriteAnswer } from '../documents.types.js';
import { isEditableFile, isRecorderFile, resolveDocPath } from '../documents.utils.js';

export interface WriteDocumentSettings {
  fs: FsClient;
}

/**
 * Writes one text document under one base, creating the folders it needs. Only text files,
 * only inside the base, never over a folder, never over the recorder's own `state.json` or
 * `cost.json`. The size limit is enforced by the body parser before the text gets here.
 */
export const writeDocumentFactory =
  ({ fs }: WriteDocumentSettings) =>
  async (base: string, parsed: ParsedDocPath, text: string): Promise<WriteAnswer> => {
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

    const bytes: number = await fs.writeTextAtomic(resolved.file, text);
    return { kind: 'saved', bytes };
  };
