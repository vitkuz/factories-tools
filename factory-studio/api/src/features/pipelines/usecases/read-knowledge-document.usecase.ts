import path from 'node:path';
import type { FsClient } from '../../../clients/fs/fs.types.js';
import type { DocumentAnswer, ParsedDocPath } from '../../documents/documents.types.js';
import { isEditableFile, isHashable } from '../../documents/documents.utils.js';
import type {
  PipelineServices,
  PipelineSkill,
  ReadKnowledgeResult,
  ResolvedKnowledgePath,
  WritableKnowledge,
} from '../pipelines.types.js';
import { knowledgeDirOf, legacyKnowledgeCandidates } from '../pipelines.utils.js';
import { locateWritableKnowledgeFactory } from './locate-writable-knowledge.usecase.js';
import { resolveKnowledgePathFactory } from './resolve-knowledge-path.usecase.js';

export interface ReadKnowledgeDocumentSettings extends Pick<
  PipelineServices,
  'listPipelineSkills'
> {
  /** Only to tell whether the file may be rewritten (`X-Doc-Writable`). */
  fs: Pick<FsClient, 'lstat' | 'realpath'>;
  readDocument: (base: string, parsed: ParsedDocPath) => Promise<DocumentAnswer>;
  workDir: string;
}

type ReadDocument = (base: string, parsed: ParsedDocPath) => Promise<DocumentAnswer>;

/**
 * The first candidate that is a file under the factory's own knowledge folder, else `null`.
 * Candidates are already-checked segments, so nothing here can leave that folder.
 */
export const findLegacyKnowledge = async (
  readDocument: ReadDocument,
  knowledgeDir: string,
  candidates: readonly (readonly string[])[],
): Promise<DocumentAnswer | null> => {
  const [first, ...rest]: readonly (readonly string[])[] = candidates;
  if (first === undefined) return null;
  const answer: DocumentAnswer = await readDocument(knowledgeDir, {
    segments: [...first],
    directory: false,
  });
  return answer.kind === 'file' ? answer : findLegacyKnowledge(readDocument, knowledgeDir, rest);
};

/**
 * A knowledge file of one pipeline: the skill is looked up fresh, the path is checked, the
 * `{{rootPath}}` / `{{skillPath}}` template (the first segment) picks the base, and the
 * document service answers. A file that is not where the path says — a run recorded before
 * the factory layout names `{{rootPath}}/knowledge/<topic>/x.md` or `{{skillPath}}/…` —
 * is looked up under the factory's own `knowledge/` by its sub-path, then by its name.
 * A file or a missing notice also says whether E16 would accept a write of it.
 */
export const readKnowledgeDocumentFactory =
  ({ listPipelineSkills, fs, readDocument, workDir }: ReadKnowledgeDocumentSettings) =>
  async (id: string, rawPath: string): Promise<ReadKnowledgeResult> => {
    const resolved: ResolvedKnowledgePath = await resolveKnowledgePathFactory({
      listPipelineSkills,
      workDir,
    })(id, rawPath);
    if (!resolved.ok && 'reason' in resolved) return { ok: false, reason: 'not-found' };
    if (!resolved.ok) return { ok: true, answer: { kind: 'refused', ...resolved.refused } };

    const { skill, base, parsed }: { skill: PipelineSkill; base: string; parsed: ParsedDocPath } =
      resolved;
    const writableAt = async (file: string): Promise<boolean> => {
      const at: WritableKnowledge = await locateWritableKnowledgeFactory({ fs })(skill, file);
      return at.ok;
    };

    const answer: DocumentAnswer = await readDocument(base, parsed);
    const found: DocumentAnswer =
      answer.kind !== 'missing' || parsed.directory
        ? answer
        : ((await findLegacyKnowledge(
            readDocument,
            knowledgeDirOf(skill.dir),
            legacyKnowledgeCandidates(parsed.segments),
          )) ?? answer);

    if (found.kind === 'file') {
      const writable: boolean =
        isHashable(found.file, found.size) && (await writableAt(found.file));
      return { ok: true, answer: { ...found, writable } };
    }
    if (found.kind === 'missing' && !parsed.directory) {
      const target: string = path.resolve(base, ...parsed.segments);
      const writable: boolean = isEditableFile(target) && (await writableAt(target));
      return { ok: true, answer: { ...found, writable } };
    }
    return { ok: true, answer: found };
  };
