import path from 'node:path';
import type { FileSystemAdapter } from '../../../adapters/file-system/index.js';
import { createAppError } from '../../../shared/utils/error.utils.js';
import { unique } from '../../../shared/utils/fp.utils.js';
import {
  DEFAULT_HARNESS,
  agentProfileCandidatesFor,
  missingProfileReason,
  type Harness,
} from '../../harness/index.js';
import type { ResolvedPipeline, ResolvedStep } from '../pipeline.types.js';
import { isCustomAgent, isGlob } from '../pipeline.utils.js';

const missingKnowledge =
  (fileSystem: FileSystemAdapter) =>
  async (step: ResolvedStep): Promise<string[]> => {
    const checks: string[][] = await Promise.all(
      step.knowledge.map(async (file: string): Promise<string[]> => {
        const found = isGlob(file)
          ? (await fileSystem.glob(file)).length > 0
          : await fileSystem.exists(file);
        return found
          ? []
          : [`${step.name}.knowledge: ${file} does not exist — the step will run without it`];
      }),
    );
    return checks.flat();
  };

const missingProfiles =
  (fileSystem: FileSystemAdapter, harness: Harness) =>
  async (pipeline: ResolvedPipeline): Promise<string[]> => {
    const agents: string[] = unique(
      Object.values(pipeline.steps).map((step: ResolvedStep): string => step.agent),
    ).filter(isCustomAgent);
    const checks: string[][] = await Promise.all(
      agents.map(async (agent: string): Promise<string[]> => {
        const found: boolean[] = await Promise.all(
          agentProfileCandidatesFor(harness)(pipeline.anchors, agent).map(fileSystem.exists),
        );
        const steps: string[] = Object.values(pipeline.steps)
          .filter((step: ResolvedStep): boolean => step.agent === agent)
          .map((step: ResolvedStep): string => step.name);
        return found.some(Boolean)
          ? []
          : [
              `agent "${agent}" ${missingProfileReason(harness)} — general-purpose will stand in for ${steps.join(', ')}`,
            ];
      }),
    );
    return checks.flat();
  };

/**
 * What only the disk can answer, asked before anything is created.
 * A root that is not a repository root is an error: the run folder and the knowledge library
 * would land in the wrong place. A missing knowledge file or a missing custom-agent profile is
 * a warning: the step runs without it, and its record says so. Profiles are looked for where the
 * harness that will run the steps keeps them.
 */
export const verifyWorkspaceFactory =
  (fileSystem: FileSystemAdapter, harness: Harness = DEFAULT_HARNESS) =>
  async (pipeline: ResolvedPipeline): Promise<ResolvedPipeline> => {
    const rootPath = pipeline.anchors.rootPath;
    if (!(await fileSystem.isDirectory(path.join(rootPath, '.claude')))) {
      throw createAppError('WORKSPACE_INVALID', 'the workspace is not ready for this pipeline', [
        `${rootPath} holds no .claude/ — run from the repository root, or pass --root`,
      ]);
    }
    const knowledge: string[][] = await Promise.all(
      Object.values(pipeline.steps).map(missingKnowledge(fileSystem)),
    );
    const profiles: string[] = await missingProfiles(fileSystem, harness)(pipeline);
    return { ...pipeline, warnings: [...pipeline.warnings, ...knowledge.flat(), ...profiles] };
  };
