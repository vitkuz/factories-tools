import path from 'node:path';
import type { FileInfo, FsClient } from '../../../clients/fs/fs.types.js';
import type { AppLogger } from '../../../shared/types.js';
import type {
  DocumentAnswer,
  ParsedDocPath,
  WriteAnswer,
  WriteGuard,
} from '../../documents/documents.types.js';
import type {
  PipelineServices,
  PipelineSkill,
  ResolvedKnowledgePath,
  WritableKnowledge,
  WriteKnowledgeResult,
} from '../pipelines.types.js';
import { knowledgeDirOf, legacyKnowledgeCandidates } from '../pipelines.utils.js';
import { locateWritableKnowledgeFactory } from './locate-writable-knowledge.usecase.js';
import { findLegacyKnowledge } from './read-knowledge-document.usecase.js';
import { resolveKnowledgePathFactory } from './resolve-knowledge-path.usecase.js';

export interface WriteKnowledgeDocumentSettings extends Pick<
  PipelineServices,
  'listPipelineSkills'
> {
  fs: Pick<FsClient, 'stat' | 'lstat' | 'realpath'>;
  /** For the legacy lookup: the file E5 showed when the stated path is not on disk. */
  readDocument: (base: string, parsed: ParsedDocPath) => Promise<DocumentAnswer>;
  writeDocument: (
    base: string,
    parsed: ParsedDocPath,
    text: string,
    guard: WriteGuard,
  ) => Promise<WriteAnswer>;
  workDir: string;
  logger?: AppLogger;
}

/**
 * E16: rewrites (or creates) one knowledge file of one of the project's own factories. The
 * path is resolved exactly as E5 reads it — the legacy fallback included, so the write lands
 * on the file the person was shown, never on a twin — and then has to sit strictly inside
 * `factories.local/<id>/knowledge/` (real paths, no linked file). The shared kit is refused.
 */
export const writeKnowledgeDocumentFactory =
  ({
    listPipelineSkills,
    fs,
    readDocument,
    writeDocument,
    workDir,
    logger,
  }: WriteKnowledgeDocumentSettings) =>
  async (
    id: string,
    rawPath: string,
    text: string,
    guard: WriteGuard,
  ): Promise<WriteKnowledgeResult> => {
    const resolved: ResolvedKnowledgePath = await resolveKnowledgePathFactory({
      listPipelineSkills,
      workDir,
    })(id, rawPath);
    if (!resolved.ok && 'reason' in resolved) return { ok: false, reason: 'not-found' };
    if (!resolved.ok) return { ok: true, answer: { kind: 'refused', ...resolved.refused } };

    const { skill, base, parsed }: { skill: PipelineSkill; base: string; parsed: ParsedDocPath } =
      resolved;
    if (parsed.directory) {
      return {
        ok: true,
        answer: { kind: 'refused', status: 400, error: 'a folder cannot be written' },
      };
    }

    const stated: string = path.resolve(base, ...parsed.segments);
    const existing: FileInfo | null = await fs.stat(stated);
    const legacy: DocumentAnswer | null =
      existing === null
        ? await findLegacyKnowledge(
            readDocument,
            knowledgeDirOf(skill.dir),
            legacyKnowledgeCandidates(parsed.segments),
          )
        : null;
    const target: string = legacy?.kind === 'file' ? legacy.file : stated;

    const at: WritableKnowledge = await locateWritableKnowledgeFactory({ fs })(skill, target);
    if (!at.ok)
      return { ok: true, answer: { kind: 'refused', status: at.status, error: at.error } };

    const answer: WriteAnswer = await writeDocument(at.base, at.parsed, text, guard);
    if (answer.kind === 'saved') {
      logger?.info('knowledge saved', {
        id,
        file: path.join(at.base, ...at.parsed.segments),
        bytes: answer.bytes,
      });
    }
    return { ok: true, answer };
  };
