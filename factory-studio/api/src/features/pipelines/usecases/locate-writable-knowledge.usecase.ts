import path from 'node:path';
import type { FsClient, LinkInfo } from '../../../clients/fs/fs.types.js';
import { isWithin } from '../../documents/documents.utils.js';
import type { PipelineSkill, WritableKnowledge } from '../pipelines.types.js';
import { KNOWLEDGE_DIR, isWritableFactory, knowledgeDirOf } from '../pipelines.utils.js';

export interface LocateWritableKnowledgeSettings {
  fs: Pick<FsClient, 'lstat' | 'realpath'>;
}

interface ExistingAncestor {
  /** The nearest folder on disk, every symlink resolved. */
  real: string;
  /** The names below it that do not exist yet (a new file's new folders). */
  tail: string[];
}

/** Walk up from `dir` to the first folder that exists; `null` when even the root is gone. */
const existingAncestor =
  (fs: Pick<FsClient, 'realpath'>) =>
  async (dir: string, tail: readonly string[] = []): Promise<ExistingAncestor | null> => {
    const real: string | null = await fs.realpath(dir);
    if (real !== null) return { real, tail: [...tail] };
    const parent: string = path.dirname(dir);
    return parent === dir ? null : existingAncestor(fs)(parent, [path.basename(dir), ...tail]);
  };

/**
 * May `target` (an absolute path resolved the way E5 reads it) be rewritten, and where
 * exactly: only in a factory of `factories.local/`, only strictly inside its own `knowledge/`
 * folder once every symlink on the way is followed, never through a symlink at the file itself,
 * and never when the knowledge folder is itself a link elsewhere. The answer's base is the
 * real knowledge folder, so the document service's own checks apply there too.
 */
export const locateWritableKnowledgeFactory =
  ({ fs }: LocateWritableKnowledgeSettings) =>
  async (skill: PipelineSkill, target: string): Promise<WritableKnowledge> => {
    if (!isWritableFactory(skill)) {
      return {
        ok: false,
        status: 403,
        error: `the shared kit is read-only in Studio: edit factories/${skill.id} in the repository`,
      };
    }
    const realFactory: string | null = await fs.realpath(skill.dir);
    const realKnowledge: string | null = await fs.realpath(knowledgeDirOf(skill.dir));
    if (
      realFactory === null ||
      realKnowledge === null ||
      realKnowledge !== path.join(realFactory, KNOWLEDGE_DIR)
    ) {
      return { ok: false, status: 403, error: 'the factory has no knowledge folder' };
    }
    const ancestor: ExistingAncestor | null = await existingAncestor(fs)(path.dirname(target));
    if (
      ancestor === null ||
      (ancestor.real !== realKnowledge && !isWithin(realKnowledge, ancestor.real))
    ) {
      return { ok: false, status: 403, error: 'outside the factory knowledge folder' };
    }
    const file: string = path.join(ancestor.real, ...ancestor.tail, path.basename(target));
    const link: LinkInfo | null = await fs.lstat(file);
    if (link?.isSymbolicLink === true) {
      return { ok: false, status: 403, error: 'a linked file cannot be edited' };
    }
    return {
      ok: true,
      base: realKnowledge,
      parsed: { segments: path.relative(realKnowledge, file).split(path.sep), directory: false },
    };
  };
