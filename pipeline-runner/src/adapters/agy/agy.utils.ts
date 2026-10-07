import type { PermissionMode } from '../../features/harness/index.js';
import type { AgentRequest, AgentUsage } from '../../features/run/index.js';
import { answerSchemaFor, modelFor, unsupportedMode } from '../agent-shared/index.js';
import type { AgyResult } from './agy.schema.js';
import type { AgyAdapterSettings } from './types.js';

/** Well under Linux's ~128 kB per-argument limit, and the rest of argv needs room too. */
export const DEFAULT_MAX_ARGV_PROMPT_BYTES = 100_000;

/** `agy --mode` knows exactly two modes, and they are the two with the same names here. */
const PERMISSION_ARGS: Partial<Record<PermissionMode, string[]>> = {
  bypassPermissions: ['--dangerously-skip-permissions'],
  acceptEdits: ['--mode', 'accept-edits'],
  plan: ['--mode', 'plan'],
};

export const permissionArgs = (mode: PermissionMode): string[] => {
  const args: string[] | undefined = PERMISSION_ARGS[mode];
  if (args === undefined)
    throw unsupportedMode('agy', mode, [
      'bypassPermissions',
      'acceptEdits (--mode accept-edits)',
      'plan (--mode plan)',
    ]);
  return args;
};

export const fitsOnArgv = (settings: AgyAdapterSettings, prompt: string): boolean =>
  Buffer.byteLength(prompt, 'utf8') <=
  (settings.maxArgvPromptBytes ?? DEFAULT_MAX_ARGV_PROMPT_BYTES);

/** What is sent instead of a prompt that does not fit on argv. */
export const pointerPrompt = (promptFile: string): string =>
  `Your task is too long for a command line, so it was written to a file. Read \`${promptFile}\` from its first line to its last before you do anything else, then carry it out exactly as if it had been given to you here — including how it tells you to finish.`;

/**
 * argv for one headless run — prompt included, as `--print=<prompt>`: agy reads no stdin, and a
 * detached `--print <prompt>` would let the flag swallow its neighbour. `--print-timeout` is
 * agy's own 5-minute fuse, raised to the step timeout.
 */
export const buildArgs =
  (settings: AgyAdapterSettings) =>
  (request: AgentRequest, prompt: string): string[] => {
    const model: string | undefined = modelFor(settings)(request.model);
    return [
      `--print=${prompt}`,
      '--output-format',
      'json',
      '--json-schema',
      answerSchemaFor(request.allowedEvents),
      '--print-timeout',
      `${Math.ceil(settings.timeoutMs / 1000)}s`,
      ...(model === undefined ? [] : ['--model', model]),
      ...(request.agentProfile === undefined ? [] : ['--agent', request.agentProfile]),
      ...(request.resumeSessionId === undefined ? [] : ['--conversation', request.resumeSessionId]),
      ...permissionArgs(settings.permissionMode),
    ];
  };

export const usageOf = (result: AgyResult): AgentUsage | undefined =>
  result.usage === undefined
    ? undefined
    : {
        ...(result.usage.input_tokens === undefined
          ? {}
          : { inputTokens: result.usage.input_tokens }),
        ...(result.usage.cache_read_tokens === undefined
          ? {}
          : { cachedInputTokens: result.usage.cache_read_tokens }),
        ...(result.usage.output_tokens === undefined
          ? {}
          : { outputTokens: result.usage.output_tokens }),
      };
