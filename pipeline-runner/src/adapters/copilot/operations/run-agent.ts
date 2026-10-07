import type { AgentRequest, AgentResult } from '../../../features/run/index.js';
import {
  runProcess,
  type ProcessResult,
  type RunProcess,
} from '../../../shared/utils/process.utils.js';
import {
  answerFromText,
  isRetry,
  processFailureOf,
  tail,
  type ParsedAnswer,
} from '../../agent-shared/index.js';
import type { CopilotEvent } from '../copilot.schema.js';
import { buildArgs, buildInput, lastMessageIn, parseEvents, resultIn } from '../copilot.utils.js';
import type { CopilotAdapterSettings } from '../types.js';

/**
 * One step, one headless process: `copilot`, the prompt on stdin, JSONL events back. There is no
 * structured output here, so the event and the reported values are read out of the answer's text.
 * Throws when there is no usable answer; the runner turns that into a failed step.
 */
export const runAgentFactory =
  (settings: CopilotAdapterSettings) =>
  async (request: AgentRequest): Promise<AgentResult> => {
    const run: RunProcess = settings.runProcess ?? runProcess;
    const args: string[] = buildArgs(settings)(request);
    const input: string = buildInput(request);
    settings.logger?.debug('copilot request', {
      step: request.stepName,
      cwd: request.cwd,
      args,
      promptChars: input.length,
    });

    const done: ProcessResult = await run({
      bin: settings.bin,
      args,
      cwd: request.cwd,
      input,
      timeoutMs: settings.timeoutMs,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    const failure: string | undefined = processFailureOf('copilot', settings.timeoutMs)(done);
    if (failure !== undefined) throw new Error(failure);

    const events: CopilotEvent[] = parseEvents(done.stdout);
    const result: CopilotEvent | undefined = resultIn(events);
    settings.logger?.debug('copilot response', {
      step: request.stepName,
      sessionId: result?.sessionId,
      exitCode: result?.exitCode ?? done.exitCode,
      usage: result?.usage,
    });
    // A refused model or a lost login ends the process before any `result` line is printed.
    if ((result?.exitCode ?? done.exitCode) !== 0)
      throw new Error(
        `copilot exited ${result?.exitCode ?? done.exitCode}: ${tail(done.stderr || done.stdout)}`,
      );
    const text: string | undefined = lastMessageIn(events);
    if (text === undefined)
      throw new Error(`copilot finished without an answer: ${tail(done.stderr || done.stdout)}`);

    const answer: ParsedAnswer = answerFromText(text, request.allowedEvents);
    const sessionId: string | undefined = result?.sessionId ?? request.resumeSessionId;
    const premiumRequests: number | undefined = result?.usage?.premiumRequests;
    const durationMs: number | undefined = result?.usage?.sessionDurationMs;
    return {
      ...answer,
      text,
      ...(sessionId === undefined ? {} : { sessionId }),
      // On a resumed session Copilot's `result.usage` is the session's total, not this call's.
      ...(premiumRequests === undefined
        ? {}
        : { usage: { premiumRequests }, usageCoversSession: isRetry(request) }),
      ...(durationMs === undefined ? {} : { durationMs }),
    };
  };
