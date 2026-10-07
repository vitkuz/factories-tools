import type { AppLogger } from '../../../shared/types.js';
import type {
  ParseDocPathResult,
  ParsedDocPath,
  WriteAnswer,
} from '../../documents/documents.types.js';
import { docPathOf, parseDocPath } from '../../documents/documents.utils.js';
import type { RunServices, WriteRunDocumentResult } from '../runs.types.js';

export interface WriteRunDocumentSettings extends Pick<RunServices, 'locateRunDir'> {
  writeDocument: (base: string, parsed: ParsedDocPath, text: string) => Promise<WriteAnswer>;
  logger?: AppLogger;
}

export const writeRunDocumentFactory =
  ({ locateRunDir, writeDocument, logger }: WriteRunDocumentSettings) =>
  async (
    pipelineId: string,
    runId: string,
    rawPath: string,
    text: string,
  ): Promise<WriteRunDocumentResult> => {
    const parsed: ParseDocPathResult = parseDocPath(rawPath);
    if (!parsed.ok) {
      return { ok: true, answer: { kind: 'refused', status: parsed.status, error: parsed.error } };
    }
    const dir: string | null = await locateRunDir(pipelineId, runId);
    if (dir === null) return { ok: false, reason: 'run-not-found' };
    const answer: WriteAnswer = await writeDocument(dir, parsed.parsed, text);
    if (answer.kind === 'saved') {
      logger?.info('document saved', { dir, path: docPathOf(parsed.parsed), bytes: answer.bytes });
    }
    return { ok: true, answer };
  };
