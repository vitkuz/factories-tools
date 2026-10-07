// Learned from factories-tools/pipeline-runner/src/features/run/services/collect-step-materials.service.ts
// and resolve-agent-profile.service.ts
import path from 'node:path';
import type { FileSystemClient } from '../../../clients/file-system/types.js';
import { isGlob } from '../../../shared/utils/path.utils.js';
import type { PathAnchors, ResolvedStep } from '../../pipeline/pipeline.types.js';
import type { InputListing, KnowledgeText, StepMaterials } from '../prompt.types.js';

/** Agents that need no profile on disk: the built-in one, and a person. */
const PROFILELESS_AGENTS: readonly string[] = ['general-purpose', 'human'];

/** A path or a pattern, turned into the files that are really there right now. */
export const expandFilesFactory =
  (fileSystem: FileSystemClient) =>
  (declared: string): string[] => {
    if (isGlob(declared)) return fileSystem.glob(declared);
    return fileSystem.exists(declared) ? [declared] : [];
  };

/** Where a custom agent's profile may live on Claude Code: the project first, then the user's home. */
const profileCandidates = (anchors: PathAnchors, agent: string): string[] => [
  path.join(anchors.rootPath, '.claude', 'agents', `${agent}.md`),
  path.join(anchors.homePath, '.claude', 'agents', `${agent}.md`),
];

/**
 * Everything a step's prompt is made of that lives on disk: the full text of each knowledge file
 * (pasted, never passed as a path and hoped for), what each declared input looks like now, and
 * whether the step's custom agent has a profile. A missing file or profile never stops the run:
 * the step runs without it and its record says so.
 */
export const collectStepMaterialsFactory =
  (fileSystem: FileSystemClient) =>
  (anchors: PathAnchors) =>
  (step: ResolvedStep): StepMaterials => {
    const expand = expandFilesFactory(fileSystem);
    const found: string[][] = step.knowledge.map(expand);
    const knowledge: KnowledgeText[] = found
      .flat()
      .map((file: string): KnowledgeText => ({ file, text: fileSystem.readText(file) }));
    const missingKnowledge: string[] = step.knowledge.filter(
      (_declared: string, index: number): boolean => (found[index] ?? []).length === 0,
    );
    const inputs: InputListing[] = step.input.map((declared: string): InputListing => ({
      declared,
      files: expand(declared),
    }));
    const custom: boolean = !PROFILELESS_AGENTS.includes(step.agent);
    const hasProfile: boolean =
      custom && profileCandidates(anchors, step.agent).some(fileSystem.exists);
    return {
      knowledge,
      missingKnowledge,
      inputs,
      ...(hasProfile ? { agentProfile: step.agent } : {}),
      notes: [
        ...(custom && !hasProfile
          ? [`agent "${step.agent}" has no profile; general-purpose stood in`]
          : []),
        ...(missingKnowledge.length === 0
          ? []
          : [`ran without knowledge: ${missingKnowledge.join(', ')}`]),
      ],
    };
  };
