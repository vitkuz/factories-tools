// Learned from factories-tools/validation/src/features/rules/index.ts
/**
 * THE RULE REGISTRY — everything `validate` checks beyond the Zod shape, in output order. The same
 * rules, in the same order, as the kit's validator; tests/contract compares the two verdicts.
 */
import type { PipelineRule, SetupRule } from './rules.types.js';
import { cwdIsRoot } from './setup/cwd-is-root.rule.js';
import { rootHasClaude } from './setup/root-has-claude.rule.js';
import { anchorsFirst } from './pipeline/anchors-first.rule.js';
import { endReachable } from './pipeline/end-reachable.rule.js';
import { humanStep } from './pipeline/human-step.rule.js';
import { idMatchesFolder } from './pipeline/id-matches-folder.rule.js';
import { knowledgeExists } from './pipeline/knowledge-exists.rule.js';
import { loopsCapped } from './pipeline/loops-capped.rule.js';
import { outputDirNotRecursive } from './pipeline/output-dir-not-recursive.rule.js';
import { placeholdersDeclared } from './pipeline/placeholders-declared.rule.js';
import { schemaRef } from './pipeline/schema-ref.rule.js';
import { startExists } from './pipeline/start-exists.rule.js';
import { stepsReachable } from './pipeline/steps-reachable.rule.js';
import { targetsExist } from './pipeline/targets-exist.rule.js';
import { wrapperSkillExists } from './pipeline/wrapper-skill-exists.rule.js';

/** Run on every invocation, even when the pipeline cannot be read. */
export const SETUP_RULES: readonly SetupRule[] = [rootHasClaude, cwdIsRoot];

/** Run once pipeline.json has passed the Zod shape. */
export const PIPELINE_RULES: readonly PipelineRule[] = [
  // the graph
  startExists,
  targetsExist,
  stepsReachable,
  endReachable,
  loopsCapped,
  humanStep,
  // names and paths
  placeholdersDeclared,
  outputDirNotRecursive,
  knowledgeExists,
  // conventions
  anchorsFirst,
  schemaRef,
  idMatchesFolder,
  wrapperSkillExists,
];

export { defineRule, reportFor, runRules } from './rules.utils.js';
export type * from './rules.types.js';
