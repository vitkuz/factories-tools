import type { AgentRequest, AgentResult } from '../../../features/run/index.js';
import {
  runProcess,
  type ProcessResult,
  type RunProcess,
} from '../../../shared/utils/process.utils.js';
import { claudeResultSchema, type ClaudeResult } from '../claude.schema.js';
import {
  answerFromStructured,
  processFailureOf,
  tail,
  type ParsedAnswer,
} from '../../agent-shared/index.js';
import { buildArgs, transcriptPathOf } from '../claude.utils.js';
import type { ClaudeAdapterSettings } from '../types.js';

const parseResult = (stdout: string): ClaudeResult => {
  const parsed = claudeResultSchema.safeParse(JSON.parse(stdout) as unknown);
  if (!parsed.success) throw new Error(`claude printed an unexpected result: ${tail(stdout)}`);
  return parsed.data;
};

/**
 * One step, one headless process: `claude -p`, the prompt on stdin, one JSON object back.
 * Throws when there is no usable answer; the runner turns that into a failed step.
 */
export const runAgentFactory =
  (settings: ClaudeAdapterSettings) =>
  async (request: AgentRequest): Promise<AgentResult> => {
    const run: RunProcess = settings.runProcess ?? runProcess;
    const args: string[] = buildArgs(settings)(request);
    settings.logger?.debug('claude request', {
      step: request.stepName,
      cwd: request.cwd,
      args,
      promptChars: request.prompt.length,
    });

    const done: ProcessResult = await run({
      bin: settings.bin,
      args,
      cwd: request.cwd,
      input: request.prompt,
      timeoutMs: settings.timeoutMs,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    const failure: string | undefined = processFailureOf('claude', settings.timeoutMs)(done);
    if (failure !== undefined) throw new Error(failure);

    const result: ClaudeResult = parseResult(done.stdout);
    settings.logger?.debug('claude response', {
      step: request.stepName,
      sessionId: result.session_id,
      subtype: result.subtype,
      costUsd: result.total_cost_usd,
      durationMs: result.duration_ms,
    });
    if (result.is_error)
      throw new Error(`claude reported ${result.subtype ?? 'an error'}: ${tail(result.result)}`);

    const answer: ParsedAnswer = answerFromStructured(
      result.structured_output,
      result.result,
      request.allowedEvents,
    );
    return {
      ...answer,
      text: result.result,
      ...(result.session_id === undefined
        ? {}
        : {
            sessionId: result.session_id,
            transcriptPath: transcriptPathOf(settings.homePath, request.cwd, result.session_id),
          }),
      ...(result.total_cost_usd === undefined ? {} : { costUsd: result.total_cost_usd }),
      ...(result.duration_ms === undefined ? {} : { durationMs: result.duration_ms }),
    };
  };
