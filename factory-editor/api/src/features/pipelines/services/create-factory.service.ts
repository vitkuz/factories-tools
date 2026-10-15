import type { FileInfo, FsClient } from '../../../clients/fs/fs.types.js';
import type { CreatePipelineResult, NewPipelineFile } from '../pipelines.types.js';
import {
  kitSkillFile,
  kitSkillLinkTarget,
  kitSkillRelativePath,
  pipelineFile,
  pipelineRelativePath,
  serialisePipelineFile,
  wrapperSkillDir,
  wrapperSkillRelativePath,
  wrapperSkillText,
} from '../pipelines.utils.js';
import { locateFactoryFactory } from './locate-factory.service.js';
import type { FactoryLocation } from './locate-factory.service.js';

export interface CreateFactorySettings {
  fs: FsClient;
  workDir: string;
}

/**
 * A new shared factory is one file in the kit, one in the skills repository and one link:
 * `factories/<id>/pipeline.json` (the body as received, like a save), the wrapper skill
 * `factories-skills/<id>/SKILL.md` that lets `/<id>` hand off to `any-factory`, and
 * `.claude/skills/<id>` → `../../factories-skills/<id>` (what factories-skills/install.sh makes) — without the link the Sessions screen cannot start the factory.
 * None may exist already (a local `factories.local/<id>` counts too): a create never overwrites,
 * and a half-made factory is reported by the file that is there.
 */
export const createFactoryFactory =
  ({ fs, workDir }: CreateFactorySettings) =>
  async (body: NewPipelineFile, raw: unknown): Promise<CreatePipelineResult> => {
    const id: string = body.id;
    const graph: string = pipelineFile(workDir, id);
    const skill: string = kitSkillFile(workDir, id);
    const link: string = wrapperSkillDir(workDir, id);
    const existingGraph: FactoryLocation | null = await locateFactoryFactory({ fs, workDir })(id);
    if (existingGraph !== null)
      return { ok: false, reason: 'exists', existing: existingGraph.path };
    const existingSkill: FileInfo | null = await fs.stat(skill);
    if (existingSkill !== null) {
      return { ok: false, reason: 'exists', existing: kitSkillRelativePath(id) };
    }
    const existingLink: FileInfo | null = await fs.stat(link);
    if (existingLink !== null) {
      return { ok: false, reason: 'exists', existing: wrapperSkillRelativePath(id) };
    }
    const bytes: number = await fs.writeTextAtomic(graph, serialisePipelineFile(raw));
    await fs.writeTextAtomic(skill, wrapperSkillText(id, body.description));
    await fs.symlink(kitSkillLinkTarget(id), link);
    return {
      ok: true,
      created: {
        kind: 'created',
        id,
        path: pipelineRelativePath(id),
        skill: kitSkillRelativePath(id),
        bytes,
      },
    };
  };
