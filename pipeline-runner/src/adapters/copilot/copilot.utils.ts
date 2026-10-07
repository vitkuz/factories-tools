import type { PermissionMode } from '../../features/harness/index.js';
import type { AgentRequest } from '../../features/run/index.js';
import {
  isRetry,
  modelFor,
  parseJsonLines,
  unsupportedMode,
  withReportBlock,
  withRole,
} from '../agent-shared/index.js';
import { copilotEventSchema, type CopilotEvent } from './copilot.schema.js';
import type { CopilotAdapterSettings } from './types.js';

/**
 * Copilot denies, without asking, whatever a non-interactive run was not allowed up front — so a
 * mode is a set of allow and deny rules. `acceptEdits` allows file writes and nothing else;
 * `plan` allows every tool except the two that change anything. The rest have no equivalent.
 */
const PERMISSION_ARGS: Partial<Record<PermissionMode, string[]>> = {
  bypassPermissions: ['--allow-all'],
  acceptEdits: ['--allow-tool=write'],
  plan: ['--allow-all-tools', '--deny-tool=write', '--deny-tool=shell'],
};

export const permissionArgs = (mode: PermissionMode): string[] => {
  const args: string[] | undefined = PERMISSION_ARGS[mode];
  if (args === undefined)
    throw unsupportedMode('copilot', mode, [
      'bypassPermissions',
      'acceptEdits (--allow-tool=write)',
      'plan (every tool but write and shell)',
    ]);
  return args;
};

/** argv for one headless run. No `-p`: with no prompt flag, Copilot reads the prompt from stdin. */
export const buildArgs =
  (settings: CopilotAdapterSettings) =>
  (request: AgentRequest): string[] => {
    const model: string | undefined = modelFor(settings)(request.model);
    return [
      '--output-format',
      'json',
      ...permissionArgs(settings.permissionMode),
      '--no-ask-user',
      ...(model === undefined ? [] : ['--model', model]),
      ...(request.agentProfile === undefined ? [] : ['--agent', request.agentProfile]),
      ...(request.resumeSessionId === undefined ? [] : [`--resume=${request.resumeSessionId}`]),
    ];
  };

/**
 * Copilot has neither a system-prompt flag nor structured output, so the first message of a
 * session carries both bridges: the role on top, the report-block convention at the bottom.
 */
export const buildInput = (request: AgentRequest): string =>
  isRetry(request)
    ? request.prompt
    : withReportBlock(withRole(request.systemPrompt, request.prompt), request.allowedEvents);

export const parseEvents = (stdout: string): CopilotEvent[] =>
  parseJsonLines(stdout).flatMap((line: unknown): CopilotEvent[] => {
    const parsed = copilotEventSchema.safeParse(line);
    return parsed.success ? [parsed.data] : [];
  });

/** A turn that only called tools has an empty message; the answer is the last one with text. */
export const lastMessageIn = (events: readonly CopilotEvent[]): string | undefined =>
  events
    .filter(
      (event: CopilotEvent): boolean =>
        event.type === 'assistant.message' && (event.data?.content ?? '').trim() !== '',
    )
    .at(-1)?.data?.content;

export const resultIn = (events: readonly CopilotEvent[]): CopilotEvent | undefined =>
  events.filter((event: CopilotEvent): boolean => event.type === 'result').at(-1);
