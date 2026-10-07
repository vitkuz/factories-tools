import type {
  ActorFact,
  BillingMode,
  TokenUsage,
  UsageEvent,
} from "../../contract/usage-event.types.js";
import type {
  ClaudeAgentLink,
  ClaudeHeadlessResult,
  ClaudeRawUsage,
  ClaudeTranscriptRecord,
} from "./claude.types.js";
import { asString, extractPromptRefs, isRecord, withTotal } from "../adapter.utils.js";
export { extractPromptRefs };
import { MAIN_ACTOR_ID } from "../../aggregation/hierarchy.js";

export const CLAUDE_ADAPTER_VERSION = "1.0.0";
export const CLAUDE_PROVIDER = "anthropic-claude" as const;

export const claudeRunId = (sessionId: string): string => `${CLAUDE_PROVIDER}:${sessionId}`;

/**
 * Anthropic reports input_tokens EXCLUDING cache reads/writes. The unified
 * contract wants inputTokens to include them (cached ⊆ input).
 */
export const normalizeClaudeUsage = (
  raw: ClaudeRawUsage,
  scope: TokenUsage["scope"],
): TokenUsage => {
  const uncached: number = raw.input_tokens ?? 0;
  const cacheRead: number = raw.cache_read_input_tokens ?? 0;
  const cacheWrite: number = raw.cache_creation_input_tokens ?? 0;
  const output: number = raw.output_tokens ?? 0;
  const reasoning: number | undefined = raw.output_tokens_details?.thinking_tokens;
  const longTtl: number | undefined = raw.cache_creation?.ephemeral_1h_input_tokens;
  return withTotal({
    scope,
    inputTokens: uncached + cacheRead + cacheWrite,
    cachedInputTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    ...(longTtl !== undefined ? { cacheWriteLongTtlTokens: longTtl } : {}),
    outputTokens: output,
    ...(reasoning !== undefined ? { reasoningTokens: reasoning } : {}),
  });
};

export const isAssistantUsageRecord = (record: ClaudeTranscriptRecord): boolean =>
  record.type === "assistant" &&
  record.message?.usage !== undefined &&
  typeof record.message.id === "string" &&
  typeof record.sessionId === "string";

/** Agent tool_use blocks in an assistant record: toolUseId -> {subagent_type, description, model}. */
export const extractAgentToolUses = (
  record: ClaudeTranscriptRecord,
): Array<{ toolUseId: string; name?: string; description?: string; model?: string }> => {
  const content: unknown = record.message?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block: unknown) => {
    if (!isRecord(block) || block.type !== "tool_use" || block.name !== "Agent") return [];
    const id: string | undefined = asString(block.id);
    if (!id) return [];
    const input: Record<string, unknown> = isRecord(block.input) ? block.input : {};
    const name: string | undefined = asString(input.subagent_type);
    const description: string | undefined = asString(input.description);
    const model: string | undefined = asString(input.model);
    return [
      {
        toolUseId: id,
        ...(name ? { name } : {}),
        ...(description ? { description } : {}),
        ...(model ? { model } : {}),
      },
    ];
  });
};

/** The tool_result record for an Agent call carries `toolUseResult.agentId`; its `message.content[].tool_use_id` links back. */
export const extractAgentToolResult = (
  record: ClaudeTranscriptRecord,
): { toolUseId?: string; agentId: string; resolvedModel?: string } | null => {
  if (!isRecord(record.toolUseResult)) return null;
  const agentId: string | undefined = asString(record.toolUseResult.agentId);
  if (!agentId) return null;
  const resolvedModel: string | undefined = asString(record.toolUseResult.resolvedModel);
  const content: unknown = record.message?.content;
  const toolUseId: string | undefined = Array.isArray(content)
    ? content
        .map((b: unknown): string | undefined =>
          isRecord(b) && b.type === "tool_result" ? asString(b.tool_use_id) : undefined,
        )
        .find((v: string | undefined): boolean => v !== undefined)
    : undefined;
  return {
    agentId,
    ...(toolUseId ? { toolUseId } : {}),
    ...(resolvedModel ? { resolvedModel } : {}),
  };
};

export type ClaudeEventContext = {
  billingMode: BillingMode;
  sourcePath: string;
  /** Actor id of the transcript file being read ("main" or a subagent id). */
  fileActorId: string;
  links: Map<string, ClaudeAgentLink>;
};

export const transcriptRecordToEvent = (
  record: ClaudeTranscriptRecord,
  ctx: ClaudeEventContext,
): UsageEvent | null => {
  if (!isAssistantUsageRecord(record)) return null;
  const sessionId: string = record.sessionId as string;
  const messageId: string = record.message?.id as string;
  const usage: ClaudeRawUsage = record.message?.usage as ClaudeRawUsage;
  const agentId: string | undefined =
    asString(record.agentId ?? undefined) ??
    (ctx.fileActorId === MAIN_ACTOR_ID ? undefined : ctx.fileActorId);
  const link: ClaudeAgentLink | undefined = agentId ? ctx.links.get(agentId) : undefined;
  const kind: UsageEvent["actor"]["kind"] = agentId
    ? "subagent"
    : record.isSidechain
      ? "auxiliary"
      : "main";
  const model: string | undefined = asString(record.message?.model);

  return {
    schemaVersion: "1",
    eventKey: `${CLAUDE_PROVIDER}:${sessionId}:${messageId}`,
    provider: CLAUDE_PROVIDER,
    adapter: { version: CLAUDE_ADAPTER_VERSION },
    timestamp: record.timestamp ?? new Date(0).toISOString(),
    run: {
      runId: claudeRunId(sessionId),
      ...(record.cwd ? { project: record.cwd } : {}),
      providerSessionId: sessionId,
      ...(record.requestId ? { requestId: record.requestId } : {}),
    },
    actor: {
      kind,
      id: agentId ?? (kind === "main" ? MAIN_ACTOR_ID : "sidechain"),
      ...(link?.name ? { name: link.name } : {}),
      ...(link?.parentActorId ? { parentId: link.parentActorId } : {}),
    },
    model: { ...(model ? { reported: model } : {}) },
    usage: normalizeClaudeUsage(usage, "request"),
    billing: { mode: ctx.billingMode, certainty: "unknown" },
    provenance: {
      source: "cli-jsonl",
      quality: "exact",
      ...(record.version ? { providerVersion: record.version } : {}),
      rawEventId: messageId,
      sourcePath: ctx.sourcePath,
    },
  };
};

export const linkToActorFact = (sessionId: string, link: ClaudeAgentLink): ActorFact => ({
  runId: claudeRunId(sessionId),
  provider: CLAUDE_PROVIDER,
  id: link.agentId,
  kind: "subagent",
  ...(link.name ? { name: link.name } : {}),
  ...(link.description ? { description: link.description } : {}),
  parentId: link.parentActorId,
  ...(link.model ? { model: link.model } : {}),
  ...(link.startedAt ? { startedAt: link.startedAt } : {}),
  ...(link.endedAt ? { endedAt: link.endedAt } : {}),
  ...(link.refs && link.refs.length > 0 ? { refs: link.refs } : {}),
});

export const firstUserPromptText = (records: ClaudeTranscriptRecord[]): string => {
  const first: ClaudeTranscriptRecord | undefined = records.find(
    (r: ClaudeTranscriptRecord): boolean => r.type === "user",
  );
  const content: unknown = first?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b: unknown): string =>
      isRecord(b) && b.type === "text" && typeof b.text === "string" ? b.text : "",
    )
    .join("\n");
};

/**
 * `claude -p --output-format json` result → session-cumulative events (one per model)
 * carrying Anthropic's own cost estimate. Never treated as billed money.
 */
export const headlessResultToEvents = (
  result: ClaudeHeadlessResult,
  opts: { billingMode: BillingMode; timestamp: string; sourcePath?: string; project?: string },
): UsageEvent[] => {
  const sessionId: string | undefined = result.session_id;
  if (!sessionId || result.type !== "result") return [];
  const models: Array<[string, NonNullable<ClaudeHeadlessResult["modelUsage"]>[string]]> =
    Object.entries(result.modelUsage ?? {});
  const base = (
    model: string | undefined,
    usage: TokenUsage,
    cost: number | undefined,
    rawId: string,
  ): UsageEvent => ({
    schemaVersion: "1",
    eventKey: `${CLAUDE_PROVIDER}:${sessionId}:cumulative:${rawId}:${usage.totalTokens ?? 0}`,
    provider: CLAUDE_PROVIDER,
    adapter: { version: CLAUDE_ADAPTER_VERSION },
    timestamp: opts.timestamp,
    run: {
      runId: claudeRunId(sessionId),
      providerSessionId: sessionId,
      ...(opts.project ? { project: opts.project } : {}),
    },
    actor: { kind: "main", id: MAIN_ACTOR_ID },
    model: { ...(model ? { reported: model } : {}) },
    usage,
    billing: {
      mode: opts.billingMode,
      ...(cost !== undefined ? { reportedCostUsd: cost } : {}),
      certainty: cost !== undefined ? "provider-estimate" : "unknown",
    },
    provenance: {
      source: "cli-jsonl",
      quality: "exact",
      rawEventId: rawId,
      ...(opts.sourcePath ? { sourcePath: opts.sourcePath } : {}),
    },
  });
  if (models.length > 0) {
    return models.map(([model, m]): UsageEvent =>
      base(
        model,
        withTotal({
          scope: "session-cumulative",
          inputTokens:
            (m.inputTokens ?? 0) +
            (m.cacheReadInputTokens ?? 0) +
            (m.cacheCreationInputTokens ?? 0),
          cachedInputTokens: m.cacheReadInputTokens ?? 0,
          cacheWriteTokens: m.cacheCreationInputTokens ?? 0,
          outputTokens: m.outputTokens ?? 0,
          ...(m.thinkingTokens !== undefined ? { reasoningTokens: m.thinkingTokens } : {}),
        }),
        m.costUSD,
        `model:${model}`,
      ),
    );
  }
  if (!result.usage) return [];
  return [
    base(
      undefined,
      normalizeClaudeUsage(result.usage, "session-cumulative"),
      result.total_cost_usd,
      "total",
    ),
  ];
};
