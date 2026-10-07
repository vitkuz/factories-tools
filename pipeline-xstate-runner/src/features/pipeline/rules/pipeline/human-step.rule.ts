// Learned from factories-tools/validation/src/features/rules/pipeline/human-step.rule.ts
import type { Step } from '../../pipeline.types.js';
import type { Finding, PipelineContext, PipelineRule } from '../rules.types.js';
import { defineRule } from '../rules.utils.js';
import { HUMAN_AGENT, stepEntries } from '../../pipeline.utils.js';

export const humanStep: PipelineRule = defineRule<PipelineContext>({
  id: 'human-step',
  description: 'A human step records its decision in an output file and sets no model.',
})(({ pipeline }, report) =>
  stepEntries(pipeline)
    .filter(([, step]: [string, Step]): boolean => step.agent === HUMAN_AGENT)
    .flatMap(([name, step]: [string, Step]): Finding[] => [
      ...((step.output ?? []).length === 0
        ? [report.error(`steps.${name}: a human step needs an output file`)]
        : []),
      ...(step.model !== undefined
        ? [report.warning(`steps.${name}: "model" is ignored on a human step`)]
        : []),
    ]),
);
