import type { AgentRequest, AgentResult, AgentUsage } from '../../../features/run/index.js';
import {
  runProcess,
  type ProcessResult,
  type RunProcess,
} from '../../../shared/utils/process.utils.js';
import {
  answerFromStructured,
  isRetry,
  processFailureOf,
  scratchFileFor,
  tail,
  withRole,
  type ParsedAnswer,
} from '../../agent-shared/index.js';
import { agyResultSchema, type AgyResult } from '../agy.schema.js';
import { buildArgs, fitsOnArgv, pointerPrompt, usageOf } from '../agy.utils.js';
import type { AgyAdapterSettings } from '../types.js';

const parseResult = (stdout: string): AgyResult => {
  const start = stdout.indexOf('{');
  try {
    const parsed = agyResultSchema.safeParse(JSON.parse(stdout.slice(Math.max(start, 0))));
    if (parsed.success) return parsed.data;
  } catch {
    // falls through to the one error below
  }
  throw new Error(`agy printed an unexpected result: ${tail(stdout)}`);
};

/** The prompt as it can travel on argv: itself, or a pointer to the file it was written to. */
const deliverableFactory =
  (settings: AgyAdapterSettings) =>
  async (request: AgentRequest, prompt: string): Promise<string> => {
    if (fitsOnArgv(settings, prompt)) return prompt;
    const promptFile: string = scratchFileFor(settings)(request, 'prompt.md');
    await settings.fileSystem.writeText(promptFile, prompt);
    settings.logger?.warn('prompt too large for argv; agy was told to read it from a file', {
      step: request.stepName,
      promptFile,
    });
    return pointerPrompt(promptFile);
  };

/**
 * One step, one headless process: `agy --print=<prompt>`, one JSON object back. agy has no
 * system-prompt flag, so the role rides at the top of the prompt. Throws when there is no usable
 * answer; the runner turns that into a failed step.
 */
export const runAgentFactory =
  (settings: AgyAdapterSettings) =>
  async (request: AgentRequest): Promise<AgentResult> => {
    const run: RunProcess = settings.runProcess ?? runProcess;
    const prompt: string = isRetry(request)
      ? request.prompt
      : withRole(request.systemPrompt, request.prompt);
    const args: string[] = buildArgs(settings)(
      request,
      await deliverableFactory(settings)(request, prompt),
    );
    settings.logger?.debug('agy request', {
      step: request.stepName,
      cwd: request.cwd,
      args: args.slice(1),
      promptChars: prompt.length,
    });

    const done: ProcessResult = await run({
      bin: settings.bin,
      args,
      cwd: request.cwd,
      timeoutMs: settings.timeoutMs,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    const failure: string | undefined = processFailureOf('agy', settings.timeoutMs)(done);
    if (failure !== undefined) throw new Error(failure);

    const result: AgyResult = parseResult(done.stdout);
    const usage: AgentUsage | undefined = usageOf(result);
    settings.logger?.debug('agy response', {
      step: request.stepName,
      sessionId: result.conversation_id,
      status: result.status,
      usage,
    });
    // The reason comes first in agy's error text and a list of models may follow: keep the head.
    if (result.error !== undefined && result.error !== '')
      throw new Error(`agy reported an error: ${result.error.trim().slice(0, 800)}`);
    if (result.status !== undefined && result.status !== 'SUCCESS')
      throw new Error(`agy ended with status ${result.status}: ${tail(done.stderr)}`);
    if (result.response.trim() === '' && result.structured_output == null)
      throw new Error(`agy finished without an answer: ${tail(done.stderr)}`);

    const answer: ParsedAnswer = answerFromStructured(
      result.structured_output,
      result.response,
      request.allowedEvents,
    );
    const sessionId: string | undefined =
      result.conversation_id === undefined || result.conversation_id === ''
        ? request.resumeSessionId
        : result.conversation_id;
    return {
      ...answer,
      text: result.response,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(usage === undefined ? {} : { usage }),
      ...(result.duration_seconds === undefined
        ? {}
        : { durationMs: Math.round(result.duration_seconds * 1000) }),
    };
  };
