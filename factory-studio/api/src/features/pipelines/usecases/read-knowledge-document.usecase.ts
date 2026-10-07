import type {
  DocumentAnswer,
  ParseDocPathResult,
  ParsedDocPath,
} from '../../documents/documents.types.js';
import { docPathOf, parseDocPath } from '../../documents/documents.utils.js';
import type { PipelineServices, PipelineSkill, ReadKnowledgeResult } from '../pipelines.types.js';
import {
  knowledgeBase,
  knowledgeDirOf,
  legacyKnowledgeCandidates,
  type KnowledgeBase,
} from '../pipelines.utils.js';

export interface ReadKnowledgeDocumentSettings extends Pick<
  PipelineServices,
  'listPipelineSkills'
> {
  readDocument: (base: string, parsed: ParsedDocPath) => Promise<DocumentAnswer>;
  workDir: string;
}

type ReadDocument = (base: string, parsed: ParsedDocPath) => Promise<DocumentAnswer>;

/**
 * The first candidate that is a file under the factory's own knowledge folder, else `null`.
 * Candidates are already-checked segments, so nothing here can leave that folder.
 */
const findLegacyKnowledge = async (
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
 */
export const readKnowledgeDocumentFactory =
  ({ listPipelineSkills, readDocument, workDir }: ReadKnowledgeDocumentSettings) =>
  async (id: string, rawPath: string): Promise<ReadKnowledgeResult> => {
    const skills: PipelineSkill[] = await listPipelineSkills();
    const skill: PipelineSkill | undefined = skills.find(
      (candidate: PipelineSkill): boolean => candidate.id === id,
    );
    if (skill === undefined) return { ok: false, reason: 'not-found' };

    const parsed: ParseDocPathResult = parseDocPath(rawPath);
    if (!parsed.ok) {
      return { ok: true, answer: { kind: 'refused', status: parsed.status, error: parsed.error } };
    }

    const { base, rest }: KnowledgeBase = knowledgeBase(docPathOf(parsed.parsed), {
      pipelineDir: skill.dir,
      workDir,
      pipeline: skill.pipeline,
    });
    const segments: string[] = rest.split('/').filter((segment: string): boolean => segment !== '');
    if (segments.length === 0) {
      return { ok: true, answer: { kind: 'refused', status: 400, error: 'empty path' } };
    }
    // A constant's value is spliced in after the request path was checked — check it again.
    if (segments.some((segment: string): boolean => segment === '.' || segment === '..')) {
      return {
        ok: true,
        answer: { kind: 'refused', status: 400, error: 'invalid path segment' },
      };
    }
    const answer: DocumentAnswer = await readDocument(base, {
      segments,
      directory: parsed.parsed.directory,
    });
    if (answer.kind !== 'missing' || parsed.parsed.directory) return { ok: true, answer };
    const legacy: DocumentAnswer | null = await findLegacyKnowledge(
      readDocument,
      knowledgeDirOf(skill.dir),
      legacyKnowledgeCandidates(segments),
    );
    return { ok: true, answer: legacy ?? answer };
  };
