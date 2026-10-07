// Learned from factories-tools/pipeline-runner/src/adapters/agent-shared/answer.utils.ts
import type { Reported } from '../harness.types.js';
import type { StructuredAnswer } from './answer.schema.js';

/** What could be read out of an agent's answer. No event is an answer too — it is asked again. */
export interface ParsedAnswer {
  event?: string;
  reported: Reported;
}

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

/** A structured answer when the harness gave one, the last line when it did not. */
export const answerFromStructured = (
  structured: StructuredAnswer | null | undefined,
  text: string,
  events: readonly string[],
): ParsedAnswer => {
  const event: string | undefined = structured?.event ?? eventFromLastLine(text, events);
  return { ...(event === undefined ? {} : { event }), reported: toReported(structured?.report) };
};

/**
 * runner.md's fallback for a harness with no system-prompt flag: the role goes at the very top of
 * the task message, and says it holds for the whole task.
 */
export const withRole = (systemPrompt: string | undefined, prompt: string): string =>
  systemPrompt === undefined || systemPrompt.trim() === ''
    ? prompt
    : `## Role\n${systemPrompt.trim()}\n\nThis role applies for the whole task below, from the first line to your final answer.\n\n${prompt}`;

export const tail = (text: string): string => text.trim().slice(-800);
