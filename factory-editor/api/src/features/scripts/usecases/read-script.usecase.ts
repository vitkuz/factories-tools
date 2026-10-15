import path from 'node:path';
import type { FsClient } from '../../../clients/fs/fs.types.js';
import type {
  DocumentAnswer,
  ParseDocPathResult,
  ParsedDocPath,
} from '../../documents/documents.types.js';
import { parseDocPath } from '../../documents/documents.utils.js';
import { isTextContentType, isWithin, MAX_SCRIPT_BYTES, SCRIPTS_DIR } from '../scripts.utils.js';

export interface ReadScriptSettings {
  fs: FsClient;
  workDir: string;
  readDocument: (base: string, parsed: ParsedDocPath) => Promise<DocumentAnswer>;
}

/**
 * One script of the repository, read-only: the path is checked (`..`, absolute paths and
 * separators inside a segment are refused), resolved under `<workDir>/scripts/` and confirmed
 * to stay there once every symlink is followed; only a text file of at most 1 MB is answered.
 * Folders are not listed and a file that is not there is a plain 404, never a notice.
 */
export const readScriptFactory =
  ({ fs, workDir, readDocument }: ReadScriptSettings) =>
  async (rawPath: string): Promise<DocumentAnswer> => {
    const parsed: ParseDocPathResult = parseDocPath(rawPath);
    if (!parsed.ok) return { kind: 'refused', status: parsed.status, error: parsed.error };
    if (parsed.parsed.directory) return { kind: 'not-found' };

    const base: string = path.join(workDir, SCRIPTS_DIR);
    const answer: DocumentAnswer = await readDocument(base, parsed.parsed);
    if (answer.kind === 'directory' || answer.kind === 'missing') return { kind: 'not-found' };
    if (answer.kind !== 'file') return answer;

    if (!isTextContentType(answer.contentType)) {
      return { kind: 'refused', status: 415, error: 'only text scripts can be read' };
    }
    if (answer.size > MAX_SCRIPT_BYTES) {
      return { kind: 'refused', status: 413, error: 'script too large' };
    }
    // A symlink inside scripts/ may point anywhere; the real path has to stay inside too.
    const realBase: string | null = await fs.realpath(base);
    const realFile: string | null = await fs.realpath(answer.file);
    if (realBase === null || realFile === null || !isWithin(realBase, realFile)) {
      return { kind: 'refused', status: 403, error: 'outside the scripts folder' };
    }
    return answer;
  };
