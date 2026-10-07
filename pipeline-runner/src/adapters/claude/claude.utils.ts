import path from 'node:path';
import type { ModelAlias } from '../../features/pipeline/index.js';
import type { AgentRequest } from '../../features/run/index.js';
import { answerSchemaFor, modelFor } from '../agent-shared/index.js';
import type { ClaudeAdapterSettings, ClaudePermissionMode } from './types.js';

/**
 * The default mode, `bypassPermissions`, is passed as the flag the factories have always been
 * launched with; any other mode is passed by name. A headless step has nobody to ask, so this
 * one setting decides everything it may do.
 */
export const permissionArgs = (mode: ClaudePermissionMode): string[] =>
  mode === 'bypassPermissions' ? ['--dangerously-skip-permissions'] : ['--permission-mode', mode];

/** A tier is Claude's own alias, so an unmapped tier is passed as it is written. */
export const claudeModelFor =
  (settings: ClaudeAdapterSettings) =>
  (tier: ModelAlias | undefined): string | undefined =>
    modelFor(settings)(tier) ?? tier;

/** argv for one headless run. The prompt is not here: it goes in on stdin, whatever its size. */
export const buildArgs =
  (settings: ClaudeAdapterSettings) =>
  (request: AgentRequest): string[] => {
    const model: string | undefined = claudeModelFor(settings)(request.model);
    return [
      '--print',
      '--output-format',
      'json',
      ...permissionArgs(settings.permissionMode),
      '--json-schema',
      answerSchemaFor(request.allowedEvents),
      ...(model === undefined ? [] : ['--model', model]),
      ...(request.agentProfile === undefined ? [] : ['--agent', request.agentProfile]),
      ...(request.systemPrompt === undefined
        ? []
        : ['--append-system-prompt', request.systemPrompt]),
      ...(request.resumeSessionId === undefined ? [] : ['--resume', request.resumeSessionId]),
    ];
  };

/** Claude Code files a session under its cwd with every separator turned into a dash. */
export const transcriptPathOf = (homePath: string, cwd: string, sessionId: string): string =>
  path.join(
    homePath,
    '.claude',
    'projects',
    cwd.replace(/[^a-zA-Z0-9]/g, '-'),
    `${sessionId}.jsonl`,
  );

// The answer parsing every adapter shares lives in agent-shared; it is still reachable from here.
export { answerSchemaFor, eventFromLastLine, toReported } from '../agent-shared/index.js';
