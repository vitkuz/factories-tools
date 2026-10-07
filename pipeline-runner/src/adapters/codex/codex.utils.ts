import type { PermissionMode } from '../../features/harness/index.js';
import type { AgentRequest, AgentUsage } from '../../features/run/index.js';
import { isRetry, modelFor, parseJsonLines, unsupportedMode } from '../agent-shared/index.js';
import { codexEventSchema, type CodexEvent } from './codex.schema.js';
import type { CodexAdapterSettings } from './types.js';

type Sandbox = 'workspace-write' | 'read-only';

/** `codex exec` never asks, so a mode is a sandbox: how much the step may touch without anyone. */
const SANDBOXES: Partial<Record<PermissionMode, Sandbox>> = {
  acceptEdits: 'workspace-write',
  plan: 'read-only',
};

/**
 * `bypassPermissions` is Codex's own skip-everything flag. `acceptEdits` and `plan` are the two
 * sandboxes that mean the same thing. `auto`, `manual` and `dontAsk` have no Codex equivalent and
 * are refused — running wider than asked is worse than not running. `exec resume` has no `-s`,
 * so there the sandbox goes in as the config value the flag stands for.
 */
export const permissionArgs = (mode: PermissionMode, resuming: boolean): string[] => {
  if (mode === 'bypassPermissions') return ['--dangerously-bypass-approvals-and-sandbox'];
  const sandbox: Sandbox | undefined = SANDBOXES[mode];
  if (sandbox === undefined)
    throw unsupportedMode('codex', mode, [
      'bypassPermissions',
      'acceptEdits (-s workspace-write)',
      'plan (-s read-only)',
    ]);
  return resuming ? ['-c', `sandbox_mode="${sandbox}"`] : ['-s', sandbox];
};

/**
 * argv for one headless run. The prompt is `-`: it goes in on stdin, whatever its size. A retry
 * is `exec resume <thread_id>`, which keeps `--json` and `--output-schema` but takes no `-C`.
 */
export const buildArgs =
  (settings: CodexAdapterSettings) =>
  (request: AgentRequest, schemaFile: string): string[] => {
    const model: string | undefined = modelFor(settings)(request.model);
    return [
      'exec',
      ...(isRetry(request) ? ['resume'] : []),
      '--json',
      '--skip-git-repo-check',
      '--output-schema',
      schemaFile,
      ...(model === undefined ? [] : ['-m', model]),
      ...(isRetry(request) ? [] : ['-C', request.cwd]),
      ...permissionArgs(settings.permissionMode, isRetry(request)),
      ...(request.resumeSessionId === undefined ? [] : [request.resumeSessionId]),
      '-',
    ];
  };

export const parseEvents = (stdout: string): CodexEvent[] =>
  parseJsonLines(stdout).flatMap((line: unknown): CodexEvent[] => {
    const parsed = codexEventSchema.safeParse(line);
    return parsed.success ? [parsed.data] : [];
  });

const ofType =
  (type: string) =>
  (event: CodexEvent): boolean =>
    event.type === type;

/**
 * `turn.failed` carries `error.message`; a bare `error` event carries `message`. Codex also
 * prints `error` while it reconnects, so that one only counts when the turn never completed.
 */
export const failureIn = (events: readonly CodexEvent[]): string | undefined => {
  const failed: CodexEvent | undefined =
    events.find(ofType('turn.failed')) ??
    (events.some(ofType('turn.completed')) ? undefined : events.find(ofType('error')));
  return failed === undefined
    ? undefined
    : (failed.error?.message ?? failed.message ?? failed.type);
};

/** The final answer is the last agent message; the ones before it are progress notes. */
export const lastMessageIn = (events: readonly CodexEvent[]): string | undefined =>
  events
    .filter(
      (event: CodexEvent): boolean =>
        event.type === 'item.completed' && event.item?.type === 'agent_message',
    )
    .at(-1)?.item?.text;

export const threadIdIn = (events: readonly CodexEvent[]): string | undefined =>
  events.find((event: CodexEvent): boolean => event.type === 'thread.started')?.thread_id;

export const usageIn = (events: readonly CodexEvent[]): AgentUsage | undefined => {
  const usage: CodexEvent['usage'] = events
    .filter((event: CodexEvent): boolean => event.type === 'turn.completed')
    .at(-1)?.usage;
  return usage === undefined
    ? undefined
    : {
        ...(usage.input_tokens === undefined ? {} : { inputTokens: usage.input_tokens }),
        ...(usage.cached_input_tokens === undefined
          ? {}
          : { cachedInputTokens: usage.cached_input_tokens }),
        ...(usage.output_tokens === undefined ? {} : { outputTokens: usage.output_tokens }),
      };
};
