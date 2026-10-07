import path from 'node:path';
import { isGlob } from '../../pipeline/index.js';
import type { ResolvedStep } from '../../pipeline/index.js';
import type { InputListing, KnowledgeText, PassInfo, StepMaterials } from '../run.types.js';

type Section = string | undefined;

const bullets = (lines: readonly string[]): string =>
  lines.map((line: string): string => `- ${line}`).join('\n');

const knowledgeSection = (knowledge: readonly KnowledgeText[]): Section =>
  knowledge.length === 0
    ? undefined
    : [
        '## Knowledge',
        'Standing instructions for this task. Follow them. Each file is fenced, so its own headings stay its own.',
        ...knowledge.map(
          ({ file, text }: KnowledgeText): string =>
            `<knowledge file="${path.basename(file)}">\n${text.trim()}\n</knowledge>`,
        ),
      ].join('\n\n');

/** A knowledge file the task may refer to but nobody can paste: say so, or the agent goes looking. */
const missingKnowledgeSection = (missing: readonly string[]): Section =>
  missing.length === 0
    ? undefined
    : `## Knowledge not available\nThese knowledge files are missing on this run. Do not look for them; do the task with your own judgement where it refers to them.\n\n${bullets(missing.map((file: string): string => path.basename(file)))}`;

const inputLine = ({ declared, files }: InputListing): string[] => {
  if (files.length === 0) return [`${declared} — not present on this pass`];
  return isGlob(declared) ? files : [declared];
};

const inputSection = (inputs: readonly InputListing[]): Section =>
  inputs.length === 0
    ? undefined
    : `## Input files\nRead every file below that is present before you start.\n\n${bullets(inputs.flatMap(inputLine))}`;

const outputLine = (declared: string): string =>
  isGlob(declared)
    ? `${path.dirname(declared)}/ — one file per item, named like \`${path.basename(declared)}\``
    : declared;

const outputSection = (outputs: readonly string[]): Section =>
  outputs.length === 0
    ? undefined
    : `## Output files\nWrite these files yourself, at exactly these paths. What you return is an event name, not their content.\n\n${bullets(outputs.map(outputLine))}`;

const workDirSection = (step: ResolvedStep): Section =>
  `## Working directory\nWork in \`${step.workDir}\`. You may create and modify files there freely.`;

const revisionSection = ({ pass, enteredBy, feedbackFiles }: PassInfo): Section =>
  pass < 2 || enteredBy === undefined
    ? undefined
    : [
        `## Revision pass ${pass}`,
        `You have run before. Step "${enteredBy.from}" returned ${enteredBy.event} and sent the work back to you.`,
        feedbackFiles.length > 0 ? `What it wrote:\n\n${bullets(feedbackFiles)}` : '',
        'Fix exactly what is listed there and leave everything else untouched.',
      ]
        .filter((part: string): boolean => part !== '')
        .join('\n\n');

const eventSection = (events: readonly string[]): Section =>
  [
    '## Events',
    `When you are finished, return exactly one of these events: ${events.map((event: string): string => `\`${event}\``).join(', ')}.`,
    'The task above says what each one means. If the task asks you to report values alongside the event, report them too.',
    'Make the event name, alone, the last line of your answer.',
  ].join('\n\n');

/**
 * The task message, in the order runner.md fixes: the prompt, the knowledge, the inputs, the
 * outputs, the events. Pure — the same step and the same materials give the same message.
 * It never mentions the state file, the recorder or the graph around the step.
 */
export const buildStepPrompt = (
  step: ResolvedStep,
  materials: StepMaterials,
  pass: PassInfo,
): string =>
  [
    step.prompt,
    revisionSection(pass),
    knowledgeSection(materials.knowledge),
    missingKnowledgeSection(materials.missingKnowledge),
    inputSection(materials.inputs),
    outputSection(step.output),
    workDirSection(step),
    eventSection(Object.keys(step.transitions)),
  ]
    .filter((section: Section): section is string => section !== undefined)
    .join('\n\n');

/** What an agent is told when its answer named no event the graph knows. Asked once, in the same session. */
export const buildRetryPrompt = (answered: string | undefined, events: readonly string[]): string =>
  `${answered === undefined ? 'Your answer named no event.' : `"${answered}" is not an event of this step.`} Return exactly one of: ${events.join(', ')}. Do no further work; just name the event that describes what you already did.`;
