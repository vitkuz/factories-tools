// Learned from factories-tools/pipeline-runner/src/adapters/claude/claude.utils.ts
import path from 'node:path';
import type { AgentRequest } from '../harness.types.js';
import { answerSchemaFor } from '../shared/answer.utils.js';
import type { ClaudeClientSettings, ClaudePermissionMode } from './types.js';

/**
 * The default mode, `bypassPermissions`, is passed as the flag the factories have always been
 * launched with; any other mode is passed by name.
 */
export const permissionArgs = (mode: ClaudePermissionMode): string[] =>
  mode === 'bypassPermissions' ? ['--dangerously-skip-permissions'] : ['--permission-mode', mode];

/** A tier is Claude's own alias, so it is passed as written; a step without one takes the default. */
export const claudeModelFor =
  (settings: Pick<ClaudeClientSettings, 'defaultModel'>) =>
  (tier: string | undefined): string | undefined =>
    tier ?? settings.defaultModel;

/** argv for one headless run. The prompt is not here: it goes in on stdin, whatever its size. */
export const buildArgs =
  (settings: ClaudeClientSettings) =>
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
