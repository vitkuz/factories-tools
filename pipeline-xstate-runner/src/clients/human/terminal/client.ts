// Learned from factories-tools/pipeline-runner/src/adapters/terminal/adapter.ts
import readline from 'node:readline';
import type { HumanClient, HumanQuestion, HumanReply } from '../human.types.js';
import type { TerminalClientSettings } from './types.js';

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

interface LineSource {
  /** The next line typed or piped in; rejects when the input ends first. */
  next: () => Promise<string>;
}

/**
 * Lines from the input, in order, whether a person types them or a pipe delivers them all at once:
 * a line that arrives before anyone asks waits in a queue, a question asked before any line arrives
 * waits for one. The two queues are the client's only state.
 */
const lineSourceOf = (settings: TerminalClientSettings): LineSource => {
  const lines: string[] = [];
  const waiting: { resolve: (line: string) => void; reject: (error: Error) => void }[] = [];
  let ended = false;
  const rl: readline.Interface = readline.createInterface({
    input: settings.input,
    terminal: false,
  });
  rl.on('line', (line: string): void => {
    const waiter = waiting.shift();
    if (waiter === undefined) lines.push(line);
    else waiter.resolve(line);
  });
  rl.on('close', (): void => {
    ended = true;
    waiting.splice(0).forEach((waiter): void => {
      waiter.reject(new Error('the input ended before an answer was given'));
    });
  });
  return {
    next: (): Promise<string> =>
      new Promise<string>((resolve, reject): void => {
        const line: string | undefined = lines.shift();
        if (line !== undefined) resolve(line);
        else if (ended) reject(new Error('the input ended before an answer was given'));
        else waiting.push({ resolve, reject });
      }),
  };
};

/** Keep asking until the answer is one of the step's events — spelled as the graph spells them. */
const askEvent = async (
  settings: TerminalClientSettings,
  source: LineSource,
  events: readonly string[],
): Promise<string> => {
  settings.output.write('> ');
  const typed: string = (await source.next()).trim().toUpperCase();
  const match: string | undefined = events.find(
    (event: string): boolean => event === typed.split(/\s+/)[0],
  );
  return match ?? askEvent(settings, source, events);
};

const askFactory =
  (settings: TerminalClientSettings, source: LineSource) =>
  (question: HumanQuestion) =>
  async (signal: AbortSignal): Promise<HumanReply> => {
    if (signal.aborted) throw new Error('the question was cancelled');
    settings.output.write(banner(question));
    const event: string = await askEvent(settings, source, question.allowedEvents);
    settings.output.write('Note for the next step (enter for none): ');
    const note: string = (await source.next()).trim();
    return { kind: 'answered', event, note };
  };

/**
 * Two human steps on parallel branches must not talk over each other, so questions queue.
 * The queue is the one piece of state here that is not a value: a terminal is shared.
 */
export const createTerminalHuman = (settings: TerminalClientSettings): HumanClient => {
  let source: LineSource | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  return {
    mode: 'terminal',
    ask:
      (question: HumanQuestion) =>
      (signal: AbortSignal): Promise<HumanReply> => {
        // The input is opened at the first question, not before: `run` without a human step never
        // touches stdin.
        source ??= lineSourceOf(settings);
        const ask = askFactory(settings, source);
        const reply: Promise<HumanReply> = queue.then((): Promise<HumanReply> =>
          ask(question)(signal),
        );
        queue = reply.catch((): undefined => undefined);
        return reply;
      },
  };
};
