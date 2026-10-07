import path from 'node:path';
import type { ModelAlias } from '../../features/pipeline/index.js';
import type { AgentRequest, Reported } from '../../features/run/index.js';
import { structuredAnswerSchema, type StructuredAnswer } from './answer.schema.js';
import type { HarnessAdapterSettings, ParsedAnswer, ScratchSettings } from './types.js';

/**
 * The answer's shape, handed to the harness's schema flag: the event is an enum of the step's own
 * events, so "which edge?" is answered by a constrained field, never by reading prose.
 */
export const answerSchemaFor = (events: readonly string[]): string =>
  JSON.stringify({
    type: 'object',
    properties: {
      event: {
        type: 'string',
        enum: events,
        description: 'The one event that describes how the task ended.',
      },
      report: {
        type: 'object',
        description:
          'Values the task asked you to report alongside the event. Empty when it asked for none.',
        additionalProperties: { type: ['string', 'number', 'boolean'] },
      },
    },
    required: ['event'],
    additionalProperties: false,
  });

/** When the structured answer is missing: the last non-empty line, if it is one of the events. */
export const eventFromLastLine = (text: string, events: readonly string[]): string | undefined => {
  const last: string | undefined = text
    .split('\n')
    .map((line: string): string => line.trim().replace(/^[`*_"']+|[`*_"'.]+$/g, ''))
    .filter((line: string): boolean => line !== '')
    .at(-1);
  return last !== undefined && events.includes(last) ? last : undefined;
};

/** Only scalars can take part in a condition; anything else the agent reported is dropped. */
export const toReported = (report: Record<string, unknown> | null | undefined): Reported =>
  Object.fromEntries(
    Object.entries(report ?? {}).filter(
      (entry: [string, unknown]): entry is [string, string | number | boolean] =>
        ['string', 'number', 'boolean'].includes(typeof entry[1]),
    ),
  );

/** A text that is, as a whole, the structured answer — what a schema-constrained harness prints. */
export const structuredFromJson = (text: string): StructuredAnswer | undefined => {
  try {
    const parsed = structuredAnswerSchema.safeParse(JSON.parse(text) as unknown);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

/** A structured answer when the harness gave one, the last line when it did not. */
export const answerFromStructured = (
  structured: StructuredAnswer | null | undefined,
  text: string,
  events: readonly string[],
): ParsedAnswer => {
  const event: string | undefined = structured?.event ?? eventFromLastLine(text, events);
  return { ...(event === undefined ? {} : { event }), reported: toReported(structured?.report) };
};

const JSON_FENCE: RegExp = /```json\s*\n([\s\S]*?)```/g;

/**
 * For a harness with no structured output. The reported values — and the event, when it is
 * there — come from the last fenced `json` block shaped `{"event": …, "report": {…}}`; without
 * one, the event is the last line and nothing was reported.
 */
export const answerFromText = (text: string, events: readonly string[]): ParsedAnswer => {
  const block: StructuredAnswer | undefined = [...text.matchAll(JSON_FENCE)]
    .map((match: RegExpMatchArray): StructuredAnswer | undefined =>
      structuredFromJson(match[1] ?? ''),
    )
    .filter((found: StructuredAnswer | undefined): found is StructuredAnswer => found !== undefined)
    .at(-1);
  return answerFromStructured(block, text.replace(JSON_FENCE, ''), events);
};

/**
 * runner.md's fallback for a harness with no system-prompt flag: the role goes at the very top of
 * the task message, and says it holds for the whole task.
 */
export const withRole = (systemPrompt: string | undefined, prompt: string): string =>
  systemPrompt === undefined || systemPrompt.trim() === ''
    ? prompt
    : `## Role\n${systemPrompt.trim()}\n\nThis role applies for the whole task below, from the first line to your final answer.\n\n${prompt}`;

/**
 * The instruction that pairs with `answerFromText`. An adapter adds it to the end of the task
 * message — only the adapter of a harness that cannot return structured data, so the message the
 * engine builds stays the same for every harness.
 */
export const withReportBlock = (prompt: string, events: readonly string[]): string =>
  [
    prompt,
    '## How to hand back the event',
    'Your answer is read by a program. End it with one fenced `json` block in exactly this shape, and write nothing after it:',
    `\`\`\`json\n{"event": "<${events.join(' | ')}>", "report": {}}\n\`\`\``,
    '`event` is the event you return. `report` holds every value the task asked you to report, by the name it used — text, numbers or true/false only; leave it `{}` when the task asked for none. This block replaces the bare event name as the last thing in your answer.',
  ].join('\n\n');

/** A retry continues a session that already has the role and the conventions; it gets neither again. */
export const isRetry = (request: AgentRequest): boolean => request.resumeSessionId !== undefined;

/** The tier a step names → this harness's model; a step that names none → the default model. */
export const modelFor =
  (settings: Pick<HarnessAdapterSettings, 'models' | 'defaultModel'>) =>
  (tier: ModelAlias | undefined): string | undefined =>
    tier === undefined ? settings.defaultModel : settings.models?.[tier];

/** A scratch file for one call of one step: under the run folder, never next to the source. */
export const scratchFileFor =
  (settings: ScratchSettings) =>
  (request: AgentRequest, name: string): string =>
    path.join(
      request.runDir ?? settings.tempDir,
      '.harness',
      `${request.stepName}${isRetry(request) ? '.retry' : ''}.${name}`,
    );

export const tail = (text: string): string => text.trim().slice(-800);

/** Every line that is a JSON value, in order. A harness may print noise between its events. */
export const parseJsonLines = (stdout: string): unknown[] =>
  stdout
    .split('\n')
    .map((line: string): string => line.trim())
    .filter((line: string): boolean => line.startsWith('{'))
    .flatMap((line: string): unknown[] => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
