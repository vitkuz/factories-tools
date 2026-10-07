import type {
  ActorFact,
  BillingMode,
  TokenUsage,
  UsageEvent,
} from "../../contract/usage-event.types.js";
import type { CodexSessionMeta, CodexThreadIndexEntry, CodexTokenUsage } from "./codex.types.js";
import { withTotal } from "../adapter.utils.js";
import { MAIN_ACTOR_ID } from "../../aggregation/hierarchy.js";

export const CODEX_ADAPTER_VERSION = "1.0.0";
export const CODEX_PROVIDER = "openai-codex" as const;

export const codexRunId = (rootThreadId: string): string => `${CODEX_PROVIDER}:${rootThreadId}`;

/** OpenAI reports input_tokens INCLUDING cached tokens - already the contract's semantics. */
export const normalizeCodexUsage = (raw: CodexTokenUsage, scope: TokenUsage["scope"]): TokenUsage =>
  withTotal({
    scope,
    inputTokens: raw.input_tokens ?? 0,
    cachedInputTokens: raw.cached_input_tokens ?? 0,
    ...(raw.cache_write_input_tokens !== undefined
      ? { cacheWriteTokens: raw.cache_write_input_tokens }
      : {}),
    outputTokens: raw.output_tokens ?? 0,
    ...(raw.reasoning_output_tokens !== undefined
      ? { reasoningTokens: raw.reasoning_output_tokens }
      : {}),
  });

export const totalOf = (u: CodexTokenUsage): number =>
  u.total_tokens ?? (u.input_tokens ?? 0) + (u.output_tokens ?? 0);

export const subtractCodexUsage = (a: CodexTokenUsage, b: CodexTokenUsage): CodexTokenUsage => ({
  input_tokens: (a.input_tokens ?? 0) - (b.input_tokens ?? 0),
  cached_input_tokens: (a.cached_input_tokens ?? 0) - (b.cached_input_tokens ?? 0),
  output_tokens: (a.output_tokens ?? 0) - (b.output_tokens ?? 0),
  reasoning_output_tokens: (a.reasoning_output_tokens ?? 0) - (b.reasoning_output_tokens ?? 0),
  total_tokens: totalOf(a) - totalOf(b),
});

/** Walks parent_thread_id links to the root; cycles/missing parents stop at the last known thread. */
export const resolveRootThread = (
  threadId: string,
  index: Map<string, CodexThreadIndexEntry>,
): string => {
  const seen: Set<string> = new Set<string>();
  let current: string = threadId;
  while (!seen.has(current)) {
    seen.add(current);
    const parent: string | null | undefined = index.get(current)?.meta.parent_thread_id;
    if (!parent || !index.has(parent)) return current;
    current = parent;
  }
  return current;
};

export const threadActorId = (meta: CodexSessionMeta, rootThreadId: string): string =>
  meta.id === rootThreadId ? MAIN_ACTOR_ID : (meta.id ?? "unknown-thread");

export const threadActorFact = (meta: CodexSessionMeta, rootThreadId: string): ActorFact | null => {
  if (!meta.id || meta.id === rootThreadId) return null;
  const name: string | undefined = meta.nickname ?? meta.role ?? undefined;
  const parent: string | undefined = meta.parent_thread_id ?? undefined;
  return {
    runId: codexRunId(rootThreadId),
    provider: CODEX_PROVIDER,
    id: meta.id,
    kind: "subagent",
    ...(name ? { name } : {}),
    ...(meta.role ? { description: meta.role } : {}),
    parentId: parent === rootThreadId ? MAIN_ACTOR_ID : (parent ?? MAIN_ACTOR_ID),
    ...(meta.timestamp ? { startedAt: meta.timestamp } : {}),
  };
};

export type CodexEventContext = {
  billingMode: BillingMode;
  sourcePath: string;
  meta: CodexSessionMeta;
  rootThreadId: string;
};

export const buildCodexEvent = (
  ctx: CodexEventContext,
  args: {
    usage: TokenUsage;
    timestamp: string;
    rawEventId: string;
    keySuffix: string;
    turnId?: string;
    model?: string;
  },
): UsageEvent => {
  const threadId: string = ctx.meta.id ?? "unknown-thread";
  const actorId: string = threadActorId(ctx.meta, ctx.rootThreadId);
  const isMain: boolean = actorId === MAIN_ACTOR_ID;
  return {
    schemaVersion: "1",
    eventKey: `${CODEX_PROVIDER}:${threadId}:${args.keySuffix}`,
    provider: CODEX_PROVIDER,
    adapter: { version: CODEX_ADAPTER_VERSION },
    timestamp: args.timestamp,
    run: {
      runId: codexRunId(ctx.rootThreadId),
      ...(ctx.meta.cwd ? { project: ctx.meta.cwd } : {}),
      providerSessionId: ctx.rootThreadId,
      providerThreadId: threadId,
      rootThreadId: ctx.rootThreadId,
      ...(ctx.meta.parent_thread_id ? { parentThreadId: ctx.meta.parent_thread_id } : {}),
      ...(args.turnId ? { turnId: args.turnId } : {}),
    },
    actor: {
      kind: isMain ? "main" : "subagent",
      id: actorId,
      ...((ctx.meta.nickname ?? ctx.meta.role)
        ? { name: (ctx.meta.nickname ?? ctx.meta.role) as string }
        : {}),
      ...(!isMain
        ? {
            parentId:
              ctx.meta.parent_thread_id === ctx.rootThreadId
                ? MAIN_ACTOR_ID
                : (ctx.meta.parent_thread_id ?? MAIN_ACTOR_ID),
          }
        : {}),
    },
    model: { ...(args.model ? { requested: args.model } : {}) },
    usage: args.usage,
    billing: { mode: ctx.billingMode, certainty: "unknown" },
    provenance: {
      source: "cli-jsonl",
      quality: "exact",
      ...(ctx.meta.cli_version ? { providerVersion: ctx.meta.cli_version } : {}),
      rawEventId: args.rawEventId,
      sourcePath: ctx.sourcePath,
    },
  };
};
