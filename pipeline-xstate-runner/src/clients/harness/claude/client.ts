// Learned from factories-tools/pipeline-runner/src/adapters/claude/operations/run-agent.ts
import { runProcess } from '../../process/client.js';
import type { ProcessResult, RunProcess } from '../../process/types.js';
import type { AgentRequest, AgentResult, HarnessClient } from '../harness.types.js';
import { answerFromStructured, tail } from '../shared/answer.utils.js';
import type { ParsedAnswer } from '../shared/answer.utils.js';
import { claudeResultSchema } from './claude.schema.js';
import type { ClaudeResult } from './claude.schema.js';
import { buildArgs, transcriptPathOf } from './claude.utils.js';
import { CLAUDE_PERMISSION_MODES } from './types.js';
import type { ClaudeClientSettings } from './types.js';

const parseResult = (stdout: string): ClaudeResult => {
  const parsed = claudeResultSchema.safeParse(JSON.parse(stdout) as unknown);
  if (!parsed.success) throw new Error(`claude printed an unexpected result: ${tail(stdout)}`);
  return parsed.data;
};

/** What went wrong when the process did not answer: killed, or nothing on stdout. */
const processFailureOf = (done: ProcessResult): string | undefined => {
  if (done.killed === 'timeout') return 'claude was killed: the step timed out';
  if (done.killed === 'aborted') return 'claude was stopped because the step was cancelled';
  if (done.stdout.trim() === '')
    return `claude exited ${done.exitCode} with no result: ${tail(done.stderr)}`;
  return undefined;
};

/**
 * One step, one headless process: `claude -p`, the prompt on stdin, one JSON object back.
 * Throws when there is no usable answer; the step machine turns that into a failed step.
 */
const runStepFactory =
  (settings: ClaudeClientSettings) =>
  (request: AgentRequest) =>
  async (signal: AbortSignal): Promise<AgentResult> => {
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
      signal,
    });
    const failure: string | undefined = processFailureOf(done);
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

export const createClaudeHarness = (settings: ClaudeClientSettings): HarnessClient => ({
  name: 'claude',
  capabilities: {
    systemPrompt: true,
    structuredOutput: true,
    resume: true,
    customAgents: true,
    costUsd: true,
    permissionModes: CLAUDE_PERMISSION_MODES,
  },
  runStep: runStepFactory(settings),
});
