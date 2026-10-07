import type {
  ActorFact,
  BillingMode,
  RunFact,
  TokenUsage,
  UsageEvent,
} from "../../contract/usage-event.types.js";
import { MAIN_ACTOR_ID } from "../../aggregation/hierarchy.js";
import { extractPromptRefs, withTotal } from "../adapter.utils.js";
import type { AntigravityConversation, AntigravityGeneration } from "./antigravity.types.js";

export const ANTIGRAVITY_ADAPTER_VERSION = "1.0.0";
export const ANTIGRAVITY_PROVIDER = "google-antigravity" as const;

export const antigravityRunId = (rootId: string): string => `${ANTIGRAVITY_PROVIDER}:${rootId}`;

/**
 * Antigravity reports input EXCLUDING cache reads (a child request showed input 2994 with 20380 cached)
 * and output INCLUDING thinking (headless: output 104, thinking 103, total = input + output).
 */
export const normalizeAntigravityUsage = (
  g: AntigravityGeneration,
  scope: TokenUsage["scope"],
): TokenUsage =>
  withTotal({
    scope,
    inputTokens: g.inputTokens + g.cacheReadTokens,
    cachedInputTokens: g.cacheReadTokens,
    outputTokens: g.outputTokens,
    reasoningTokens: g.thinkingTokens,
  });

/** Root conversation = the top of the parentId chain among the conversations we know. */
export const resolveRoot = (id: string, byId: Map<string, AntigravityConversation>): string => {
  const seen: Set<string> = new Set<string>();
  let current: string = id;
  while (!seen.has(current)) {
    seen.add(current);
    const parent: string | null | undefined = byId.get(current)?.parentId;
    if (!parent) return current;
    current = parent;
  }
  return current;
};

export const generationToEvent = (
  conversation: AntigravityConversation,
  g: AntigravityGeneration,
  ctx: { rootId: string; billingMode: BillingMode; sourcePath: string },
): UsageEvent => {
  const isMain: boolean = conversation.id === ctx.rootId;
  return {
    schemaVersion: "1",
    eventKey: `${ANTIGRAVITY_PROVIDER}:${conversation.id}:gen:${g.idx}:${g.genId ?? ""}`,
    provider: ANTIGRAVITY_PROVIDER,
    adapter: { version: ANTIGRAVITY_ADAPTER_VERSION },
    timestamp: g.timestamp ?? conversation.updatedAt ?? new Date(0).toISOString(),
    run: {
      runId: antigravityRunId(ctx.rootId),
      ...(conversation.workspace ? { project: conversation.workspace } : {}),
      providerSessionId: ctx.rootId,
      providerThreadId: conversation.id,
      rootThreadId: ctx.rootId,
      ...(conversation.parentId ? { parentThreadId: conversation.parentId } : {}),
    },
    actor: {
      kind: isMain ? "main" : "subagent",
      id: isMain ? MAIN_ACTOR_ID : conversation.id,
      ...(conversation.agentName && !isMain ? { name: conversation.agentName } : {}),
      ...(!isMain
        ? {
            parentId:
              conversation.parentId === ctx.rootId
                ? MAIN_ACTOR_ID
                : (conversation.parentId ?? MAIN_ACTOR_ID),
          }
        : {}),
    },
    model: { ...(g.model ? { reported: g.model } : {}) },
    usage: normalizeAntigravityUsage(g, "request"),
    billing: { mode: ctx.billingMode, certainty: "unknown" },
    provenance: {
      source: "sqlite",
      quality: "exact",
      rawEventId: String(g.idx),
      sourcePath: ctx.sourcePath,
    },
  };
};

export const conversationToActorFact = (
  conversation: AntigravityConversation,
  rootId: string,
): ActorFact | null => {
  if (conversation.id === rootId) return null;
  const refs: string[] = extractPromptRefs(conversation.firstPrompt);
  return {
    runId: antigravityRunId(rootId),
    provider: ANTIGRAVITY_PROVIDER,
    id: conversation.id,
    kind: "subagent",
    ...(conversation.agentName ? { name: conversation.agentName } : {}),
    parentId:
      conversation.parentId === rootId ? MAIN_ACTOR_ID : (conversation.parentId ?? MAIN_ACTOR_ID),
    ...(conversation.startedAt ? { startedAt: conversation.startedAt } : {}),
    ...(conversation.updatedAt ? { endedAt: conversation.updatedAt } : {}),
    ...(refs.length > 0 ? { refs } : {}),
  };
};

export const conversationToRunFact = (
  conversation: AntigravityConversation,
  billingMode: BillingMode,
): RunFact => ({
  runId: antigravityRunId(conversation.id),
  provider: ANTIGRAVITY_PROVIDER,
  providerSessionId: conversation.id,
  ...(conversation.workspace ? { project: conversation.workspace } : {}),
  ...(conversation.startedAt ? { startedAt: conversation.startedAt } : {}),
  billingMode,
});
