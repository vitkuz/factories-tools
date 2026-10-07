import type {
  DocumentAnswer,
  ParseDocPathResult,
  ParsedDocPath,
} from '../../documents/documents.types.js';
import { parseDocPath } from '../../documents/documents.utils.js';
import type { ReadRunDocumentResult, RunServices } from '../runs.types.js';

export interface ReadRunDocumentSettings extends Pick<RunServices, 'locateRunDir'> {
  readDocument: (base: string, parsed: ParsedDocPath) => Promise<DocumentAnswer>;
}

export const readRunDocumentFactory =
  ({ locateRunDir, readDocument }: ReadRunDocumentSettings) =>
  async (pipelineId: string, runId: string, rawPath: string): Promise<ReadRunDocumentResult> => {
    const parsed: ParseDocPathResult = parseDocPath(rawPath);
    if (!parsed.ok) {
      return { ok: true, answer: { kind: 'refused', status: parsed.status, error: parsed.error } };
    }
    const dir: string | null = await locateRunDir(pipelineId, runId);
    if (dir === null) return { ok: false, reason: 'run-not-found' };
    return { ok: true, answer: await readDocument(dir, parsed.parsed) };
  };
