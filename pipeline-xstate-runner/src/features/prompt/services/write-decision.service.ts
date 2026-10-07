// Learned from factories-tools/pipeline-runner/src/features/run/services/execute-human-step.service.ts
import type { FileSystemClient } from '../../../clients/file-system/types.js';
import { isGlob } from '../../../shared/utils/path.utils.js';
import type { ResolvedStep } from '../../pipeline/pipeline.types.js';

export interface Decision {
  event: string;
  note: string;
  at: string;
}

/** The decision file later steps obey: written by the runner, never by an agent. */
export const decisionText = (step: ResolvedStep, decision: Decision): string =>
  [
    `# Decision — ${step.name}`,
    '',
    `- **Answer:** ${decision.event}`,
    `- **At:** ${decision.at}`,
    '',
    '## Note',
    '',
    decision.note === '' ? '_none_' : decision.note,
    '',
  ].join('\n');

/** The step's first plain (non-glob) output is where the decision lands. */
export const decisionFileOf = (step: ResolvedStep): string | undefined =>
  step.output.find((file: string): boolean => !isGlob(file));

export const writeDecisionFactory =
  (fileSystem: FileSystemClient) =>
  (step: ResolvedStep, decision: Decision): void => {
    const target: string | undefined = decisionFileOf(step);
    if (target !== undefined) fileSystem.writeText(target, decisionText(step, decision));
  };
