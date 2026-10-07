import type { ActorFact, BillingMode, UsageEvent } from "../../contract/usage-event.types.js";
import type { CopilotSessionEvent, CopilotSubagentInfo, CopilotUsageRow } from "./copilot.types.js";
import { asNumber, asString, extractPromptRefs, isRecord, withTotal } from "../adapter.utils.js";
import { MAIN_ACTOR_ID } from "../../aggregation/hierarchy.js";

export const COPILOT_ADAPTER_VERSION = "1.0.0";
export const COPILOT_PROVIDER = "github-copilot" as const;
export const COPILOT_UNIT = "github_ai_credit";
export const COPILOT_PREMIUM_UNIT = "github_premium_request";
const NANO = 1_000_000_000;

export const copilotRunId = (sessionId: string): string => `${COPILOT_PROVIDER}:${sessionId}`;

export const nanoAiuToCredits = (nano: number): number => nano / NANO;

export type CopilotRowContext = {
  billingMode: BillingMode;
  sourcePath: string;
  project?: string;
  subagents: Map<string, CopilotSubagentInfo>;
};

/** Copilot's input_tokens already INCLUDE cache_read + cache_write (verified against token_details_json). */
export const usageRowToEvent = (row: CopilotUsageRow, ctx: CopilotRowContext): UsageEvent => {
  const agentId: string | null = row.agent_id;
  const info: CopilotSubagentInfo | undefined =
    (agentId ? ctx.subagents.get(agentId) : undefined) ??
    (row.parent_tool_call_id ? ctx.subagents.get(row.parent_tool_call_id) : undefined);
  const isSub: boolean = agentId !== null && agentId !== undefined;
  const parent: string | null = row.parent_tool_call_id;
  const credits: number | undefined =
    row.total_nano_aiu !== null ? nanoAiuToCredits(row.total_nano_aiu) : undefined;
  return {
    schemaVersion: "1",
    eventKey: `${COPILOT_PROVIDER}:${row.session_id}:usage-row:${row.id}`,
    provider: COPILOT_PROVIDER,
    adapter: { version: COPILOT_ADAPTER_VERSION },
    timestamp: row.created_at ?? new Date(0).toISOString(),
    run: {
      runId: copilotRunId(row.session_id),
      ...(ctx.project ? { project: ctx.project } : {}),
      providerSessionId: row.session_id,
      ...(row.turn_index !== null ? { turnId: String(row.turn_index) } : {}),
    },
    actor: {
      kind: isSub ? "subagent" : "main",
      id: isSub ? (agentId as string) : MAIN_ACTOR_ID,
      ...(info?.agentName ? { name: info.agentName } : {}),
      ...(isSub ? { parentId: parent && parent !== agentId ? parent : MAIN_ACTOR_ID } : {}),
    },
    model: { reported: row.model },
    usage: withTotal({
      scope: "request",
      inputTokens: row.input_tokens ?? 0,
      cachedInputTokens: row.cache_read_tokens ?? 0,
      cacheWriteTokens: row.cache_write_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
      ...(row.reasoning_tokens !== null ? { reasoningTokens: row.reasoning_tokens } : {}),
    }),
    billing: {
      mode: ctx.billingMode,
      ...(credits !== undefined ? { providerUnit: { name: COPILOT_UNIT, amount: credits } } : {}),
      // A premium request is charged per USER prompt × model multiplier; agent/sub-agent calls are free.
      // Verified: Σ multiplier over initiator="user" rows equals session.usage_checkpoint.totalPremiumRequests.
      ...(row.initiator === "user" && row.request_multiplier !== null
        ? { extraUnits: [{ name: COPILOT_PREMIUM_UNIT, amount: row.request_multiplier }] }
        : {}),
      certainty: "unknown",
    },
    provenance: {
      source: "sqlite",
      quality: "exact",
      rawEventId: String(row.id),
      sourcePath: ctx.sourcePath,
    },
  };
};

/**
 * Subagent identity from session-state/<id>/events.jsonl. Keyed by every id Copilot uses for the agent:
 * the tool call id (old usage rows) and the UUID in `subagent.started.agentId` (usage rows since 1.0.8x).
 * The `task` tool call carries the full prompt, which yields the step/output references.
 */
export const extractSubagents = (
  events: CopilotSessionEvent[],
): Map<string, CopilotSubagentInfo> => {
  const byToolCall: Map<string, CopilotSubagentInfo> = new Map<string, CopilotSubagentInfo>();
  const upsert = (toolCallId: string, patch: Partial<CopilotSubagentInfo>): void => {
    byToolCall.set(toolCallId, { ...(byToolCall.get(toolCallId) ?? { toolCallId }), ...patch });
  };
  events.forEach((event: CopilotSessionEvent): void => {
    const data: Record<string, unknown> = isRecord(event.data) ? event.data : {};
    if (event.type === "tool.execution_start" && data.toolName === "task") {
      const toolCallId: string | undefined = asString(data.toolCallId);
      const args: Record<string, unknown> = isRecord(data.arguments) ? data.arguments : {};
      if (!toolCallId) return;
      const prompt: string | undefined = asString(args.prompt);
      const description: string | undefined = asString(args.description) ?? asString(args.name);
      const agentType: string | undefined = asString(args.agent_type);
      upsert(toolCallId, {
        ...(prompt ? { refs: extractPromptRefs(prompt) } : {}),
        ...(description ? { description } : {}),
        ...(agentType ? { agentName: agentType } : {}),
      });
      return;
    }
    if (event.type !== "subagent.started" && event.type !== "subagent.completed") return;
    const toolCallId: string | undefined =
      asString(data.toolCallId) ?? asString(event.agentId ?? undefined);
    if (!toolCallId) return;
    const eventAgentId: string | undefined = asString(event.agentId ?? undefined);
    const agentName: string | undefined = asString(data.agentName) ?? asString(data.agentType);
    const agentDisplayName: string | undefined = asString(data.agentDisplayName);
    const model: string | undefined = asString(data.model);
    const totalTokens: number | undefined = asNumber(data.totalTokens);
    upsert(toolCallId, {
      ...(eventAgentId && eventAgentId !== toolCallId ? { agentId: eventAgentId } : {}),
      ...(agentName ? { agentName } : {}),
      ...(agentDisplayName ? { agentDisplayName } : {}),
      ...(model ? { model } : {}),
      ...(event.type === "subagent.started" && event.timestamp
        ? { startedAt: event.timestamp }
        : {}),
      ...(event.type === "subagent.completed" && event.timestamp
        ? { endedAt: event.timestamp }
        : {}),
      ...(totalTokens !== undefined ? { totalTokens } : {}),
    });
  });
  const map: Map<string, CopilotSubagentInfo> = new Map<string, CopilotSubagentInfo>();
  byToolCall.forEach((info: CopilotSubagentInfo): void => {
    map.set(info.toolCallId, info);
    if (info.agentId) map.set(info.agentId, info);
  });
  return map;
};

/** Last session.usage_checkpoint → session-cumulative provider-unit snapshot (no token totals exposed). */
export const extractUsageCheckpoint = (
  events: CopilotSessionEvent[],
): { nanoAiu: number; premiumRequests?: number; timestamp: string; id?: string } | null => {
  const checkpoints: CopilotSessionEvent[] = events.filter(
    (e: CopilotSessionEvent): boolean => e.type === "session.usage_checkpoint",
  );
  const last: CopilotSessionEvent | undefined = checkpoints[checkpoints.length - 1];
  if (!last || !isRecord(last.data)) return null;
  const nano: number | undefined = asNumber(last.data.totalNanoAiu);
  if (nano === undefined) return null;
  const premium: number | undefined = asNumber(last.data.totalPremiumRequests);
  return {
    nanoAiu: nano,
    ...(premium !== undefined ? { premiumRequests: premium } : {}),
    timestamp: last.timestamp ?? new Date(0).toISOString(),
    ...(last.id ? { id: last.id } : {}),
  };
};

export const checkpointToEvent = (
  sessionId: string,
  checkpoint: { nanoAiu: number; premiumRequests?: number; timestamp: string; id?: string },
  ctx: CopilotRowContext,
): UsageEvent => ({
  schemaVersion: "1",
  eventKey: `${COPILOT_PROVIDER}:${sessionId}:cumulative:${checkpoint.nanoAiu}`,
  provider: COPILOT_PROVIDER,
  adapter: { version: COPILOT_ADAPTER_VERSION },
  timestamp: checkpoint.timestamp,
  run: {
    runId: copilotRunId(sessionId),
    providerSessionId: sessionId,
    ...(ctx.project ? { project: ctx.project } : {}),
  },
  actor: { kind: "main", id: MAIN_ACTOR_ID },
  model: {},
  usage: { scope: "session-cumulative" },
  billing: {
    mode: ctx.billingMode,
    providerUnit: { name: COPILOT_UNIT, amount: nanoAiuToCredits(checkpoint.nanoAiu) },
    ...(checkpoint.premiumRequests !== undefined
      ? { extraUnits: [{ name: COPILOT_PREMIUM_UNIT, amount: checkpoint.premiumRequests }] }
      : {}),
    certainty: "unknown",
  },
  provenance: {
    source: "session-log",
    quality: "exact",
    ...(checkpoint.id ? { rawEventId: checkpoint.id } : {}),
    sourcePath: ctx.sourcePath,
  },
});

export const subagentToActorFact = (sessionId: string, info: CopilotSubagentInfo): ActorFact => ({
  runId: copilotRunId(sessionId),
  provider: COPILOT_PROVIDER,
  id: info.agentId ?? info.toolCallId,
  kind: "subagent",
  ...(info.agentName ? { name: info.agentName } : {}),
  ...((info.description ?? info.agentDisplayName)
    ? { description: (info.description ?? info.agentDisplayName) as string }
    : {}),
  ...(info.refs && info.refs.length > 0 ? { refs: info.refs } : {}),
  parentId: MAIN_ACTOR_ID,
  ...(info.model ? { model: info.model } : {}),
  ...(info.startedAt ? { startedAt: info.startedAt } : {}),
  ...(info.endedAt ? { endedAt: info.endedAt } : {}),
});
