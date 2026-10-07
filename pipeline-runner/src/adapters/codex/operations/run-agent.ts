import type { AgentRequest, AgentResult, AgentUsage } from '../../../features/run/index.js';
import {
  runProcess,
  type ProcessResult,
  type RunProcess,
} from '../../../shared/utils/process.utils.js';
import {
  answerFromStructured,
  answerSchemaFor,
  isRetry,
  processFailureOf,
  scratchFileFor,
  structuredFromJson,
  tail,
  withRole,
  type ParsedAnswer,
} from '../../agent-shared/index.js';
import type { CodexEvent } from '../codex.schema.js';
import {
  buildArgs,
  failureIn,
  lastMessageIn,
  parseEvents,
  threadIdIn,
  usageIn,
} from '../codex.utils.js';
import type { CodexAdapterSettings } from '../types.js';

/**
 * One step, one headless process: `codex exec --json`, the prompt on stdin, JSONL events back.
 * Codex has no system-prompt flag, so the role rides at the top of the prompt; it has no agent
 * profiles, so `agentProfile` never reaches it. Throws when there is no usable answer.
 */
export const runAgentFactory =
  (settings: CodexAdapterSettings) =>
  async (request: AgentRequest): Promise<AgentResult> => {
    const run: RunProcess = settings.runProcess ?? runProcess;
    const schemaFile: string = scratchFileFor(settings)(request, 'answer-schema.json');
    const args: string[] = buildArgs(settings)(request, schemaFile);
    const input: string = isRetry(request)
      ? request.prompt
      : withRole(request.systemPrompt, request.prompt);
    settings.logger?.debug('codex request', {
      step: request.stepName,
      cwd: request.cwd,
      args,
      promptChars: input.length,
    });

    await settings.fileSystem.writeText(schemaFile, answerSchemaFor(request.allowedEvents));
    const started: number = Date.now();
    const done: ProcessResult = await run({
      bin: settings.bin,
      args,
      cwd: request.cwd,
      input,
      timeoutMs: settings.timeoutMs,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    const failure: string | undefined = processFailureOf('codex', settings.timeoutMs)(done);
    if (failure !== undefined) throw new Error(failure);

    const events: CodexEvent[] = parseEvents(done.stdout);
    const sessionId: string | undefined = threadIdIn(events) ?? request.resumeSessionId;
    const usage: AgentUsage | undefined = usageIn(events);
    settings.logger?.debug('codex response', {
      step: request.stepName,
      sessionId,
      events: events.length,
      usage,
    });
    const reported: string | undefined = failureIn(events);
    if (reported !== undefined) throw new Error(`codex reported an error: ${tail(reported)}`);
    const text: string | undefined = lastMessageIn(events);
    if (text === undefined || text.trim() === '')
      throw new Error(
        `codex exited ${done.exitCode} without an answer: ${tail(done.stderr || done.stdout)}`,
      );

    const answer: ParsedAnswer = answerFromStructured(
      structuredFromJson(text),
      text,
      request.allowedEvents,
    );
    return {
      ...answer,
      text,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(usage === undefined ? {} : { usage }),
      durationMs: Date.now() - started,
    };
  };
