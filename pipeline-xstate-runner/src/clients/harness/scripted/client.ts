import path from 'node:path';
import type { AgentRequest, AgentResult, HarnessClient } from '../harness.types.js';
import type { ScriptedAnswer, ScriptedCall, ScriptedClientSettings } from './types.js';

export interface ScriptedHarness extends HarnessClient {
  /** The requests received so far. */
  calls: () => readonly ScriptedCall[];
}

const NEVER: Promise<never> = new Promise<never>((): void => undefined);

const wait = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject): void => {
    const timer: NodeJS.Timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      (): void => {
        clearTimeout(timer);
        reject(new Error('the step was cancelled'));
      },
      { once: true },
    );
  });

const callOf = (request: AgentRequest): ScriptedCall => ({
  step: request.stepName,
  prompt: request.prompt,
  ...(request.systemPrompt === undefined ? {} : { systemPrompt: request.systemPrompt }),
  ...(request.model === undefined ? {} : { model: request.model }),
  ...(request.resumeSessionId === undefined ? {} : { resumeSessionId: request.resumeSessionId }),
});

const resultOf = (answer: ScriptedAnswer): AgentResult => ({
  ...(answer.event === undefined ? {} : { event: answer.event }),
  reported: answer.report ?? {},
  text: answer.text ?? answer.event ?? '',
  ...(answer.sessionId === undefined ? {} : { sessionId: answer.sessionId }),
  ...(answer.costUsd === undefined ? {} : { costUsd: answer.costUsd }),
  ...(answer.usage === undefined ? {} : { usage: answer.usage }),
  ...(answer.durationMs === undefined ? {} : { durationMs: answer.durationMs }),
});

/**
 * A fake harness for tests and dry runs: each call of a step takes the next scripted answer,
 * writes the files the answer lists and hands the answer back. No process, no model, no cost.
 * The script cursor and the call log are the fake's only state.
 */
export const createScriptedHarness = (settings: ScriptedClientSettings): ScriptedHarness => {
  const taken: Map<string, number> = new Map();
  const calls: ScriptedCall[] = [];

  const next = (step: string): ScriptedAnswer => {
    const index: number = taken.get(step) ?? 0;
    taken.set(step, index + 1);
    const answer: ScriptedAnswer | undefined = settings.script[step]?.[index];
    if (answer === undefined)
      throw new Error(`the script has no answer #${index + 1} for step "${step}"`);
    return answer;
  };

  const runStep =
    (request: AgentRequest) =>
    async (signal: AbortSignal): Promise<AgentResult> => {
      calls.push(callOf(request));
      const answer: ScriptedAnswer = next(request.stepName);
      settings.logger?.debug('scripted answer', { step: request.stepName, answer });
      if (answer.hang === true) return NEVER;
      if (answer.delayMs !== undefined) await wait(answer.delayMs, signal);
      if (answer.fail !== undefined) throw new Error(answer.fail);
      Object.entries(answer.writes ?? {}).forEach(([file, text]: [string, string]): void => {
        settings.fileSystem.writeText(path.join(request.runDir, file), text);
      });
      return resultOf(answer);
    };

  return {
    name: 'scripted',
    capabilities: {
      systemPrompt: true,
      structuredOutput: true,
      resume: true,
      customAgents: true,
      costUsd: false,
      permissionModes: ['acceptEdits', 'auto', 'bypassPermissions', 'manual', 'dontAsk', 'plan'],
    },
    runStep,
    calls: (): readonly ScriptedCall[] => [...calls],
  };
};
