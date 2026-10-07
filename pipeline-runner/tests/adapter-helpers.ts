import type { AgentRequest } from '../src/features/run/index.js';
import type { ProcessRequest, ProcessResult } from '../src/shared/utils/process.utils.js';

export const REQUEST: AgentRequest = {
  stepName: 'review',
  prompt: 'Review it.',
  systemPrompt: 'You are strict.',
  model: 'opus',
  cwd: '/repo',
  runDir: '/repo/run/demo',
  allowedEvents: ['APPROVE', 'REVISE'],
};

/** A `runProcess` that starts nothing: it remembers what it was asked and answers from `reply`. */
export const fakeProcess =
  (reply: Partial<ProcessResult>, seen: ProcessRequest[] = []) =>
  async (request: ProcessRequest): Promise<ProcessResult> => {
    seen.push(request);
    return { exitCode: 0, stdout: '', stderr: '', ...reply };
  };

export const jsonLines = (...events: Record<string, unknown>[]): string =>
  events.map((event: Record<string, unknown>): string => JSON.stringify(event)).join('\n');

/** The slice of the file system an adapter may write scratch files through. */
export const scratch = (): {
  written: Map<string, string>;
  writeText: (file: string, text: string) => Promise<void>;
} => {
  const written: Map<string, string> = new Map();
  return {
    written,
    writeText: async (file: string, text: string): Promise<void> => void written.set(file, text),
  };
};
