import readline from 'node:readline/promises';
import type { HumanAnswer, HumanQuestion } from '../../features/run/index.js';
import type { TerminalAdapter, TerminalAdapterSettings } from './types.js';

const banner = ({ stepName, question, files, allowedEvents }: HumanQuestion): string =>
  [
    '',
    `━━ your decision: ${stepName} ━━`,
    question,
    ...(files.length === 0
      ? []
      : ['', 'Look at:', ...files.map((file: string): string => `  ${file}`)]),
    '',
    `Answer one of: ${allowedEvents.join(' | ')}`,
    '',
  ].join('\n');

/** Keep asking until the answer is one of the step's events — spelled as the graph spells them. */
const askEvent = async (rl: readline.Interface, events: readonly string[]): Promise<string> => {
  const typed = (await rl.question('> ')).trim().toUpperCase();
  const match: string | undefined = events.find(
    (event: string): boolean => event === typed.split(/\s+/)[0],
  );
  return match ?? askEvent(rl, events);
};

const askFactory =
  (settings: TerminalAdapterSettings) =>
  async (question: HumanQuestion): Promise<HumanAnswer> => {
    if (settings.input.isTTY !== true) {
      throw new Error(
        `step "${question.stepName}" asks a person, and there is no terminal to ask on`,
      );
    }
    const rl: readline.Interface = readline.createInterface({
      input: settings.input,
      output: settings.output,
    });
    try {
      settings.output.write(banner(question));
      const event = await askEvent(rl, question.allowedEvents);
      const note = (await rl.question('Note for the next step (enter for none): ')).trim();
      return { event, note };
    } finally {
      rl.close();
    }
  };

/**
 * Two human steps on parallel branches must not talk over each other, so questions queue.
 * The queue is the one piece of state in this tool that is not a value: a terminal is shared.
 */
export const createTerminalAdapter = (settings: TerminalAdapterSettings): TerminalAdapter => {
  const ask = askFactory(settings);
  let queue: Promise<unknown> = Promise.resolve();
  return {
    ask: (question: HumanQuestion): Promise<HumanAnswer> => {
      const answer: Promise<HumanAnswer> = queue.then((): Promise<HumanAnswer> => ask(question));
      queue = answer.catch((): undefined => undefined);
      return answer;
    },
  };
};
