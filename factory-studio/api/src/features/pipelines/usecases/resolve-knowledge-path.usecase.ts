import type { ParseDocPathResult } from '../../documents/documents.types.js';
import { docPathOf, parseDocPath } from '../../documents/documents.utils.js';
import type { PipelineServices, PipelineSkill, ResolvedKnowledgePath } from '../pipelines.types.js';
import { knowledgeBase, type KnowledgeBase } from '../pipelines.utils.js';

export interface ResolveKnowledgePathSettings extends Pick<PipelineServices, 'listPipelineSkills'> {
  workDir: string;
}

/**
 * One knowledge path of one pipeline, resolved the one way E5 reads it and E16 writes it: the
 * skill is looked up fresh, the path is checked, the constants are expanded and the
 * `{{rootPath}}` / `{{skillPath}}` template (the first segment) picks the base.
 */
export const resolveKnowledgePathFactory =
  ({ listPipelineSkills, workDir }: ResolveKnowledgePathSettings) =>
  async (id: string, rawPath: string): Promise<ResolvedKnowledgePath> => {
    const skills: PipelineSkill[] = await listPipelineSkills();
    const skill: PipelineSkill | undefined = skills.find(
      (candidate: PipelineSkill): boolean => candidate.id === id,
    );
    if (skill === undefined) return { ok: false, reason: 'not-found' };

    const parsed: ParseDocPathResult = parseDocPath(rawPath);
    if (!parsed.ok) return { ok: false, refused: { status: parsed.status, error: parsed.error } };

    const { base, rest }: KnowledgeBase = knowledgeBase(docPathOf(parsed.parsed), {
      pipelineDir: skill.dir,
      workDir,
      pipeline: skill.pipeline,
    });
    const segments: string[] = rest.split('/').filter((segment: string): boolean => segment !== '');
    if (segments.length === 0) return { ok: false, refused: { status: 400, error: 'empty path' } };
    // A constant's value is spliced in after the request path was checked — check it again.
    if (segments.some((segment: string): boolean => segment === '.' || segment === '..')) {
      return { ok: false, refused: { status: 400, error: 'invalid path segment' } };
    }
    return { ok: true, skill, base, parsed: { segments, directory: parsed.parsed.directory } };
  };
