import { z } from "zod";

export const providerSchema = z.enum([
  "github-copilot",
  "anthropic-claude",
  "openai-codex",
  "google-antigravity",
]);
export const actorKindSchema = z.enum(["main", "subagent", "auxiliary", "unattributed"]);
export const usageScopeSchema = z.enum(["request", "turn", "session", "session-cumulative"]);
export const billingModeSchema = z.enum([
  "api-payg",
  "subscription",
  "provider-credits",
  "unknown",
]);
export const costCertaintySchema = z.enum([
  "authoritative",
  "provider-estimate",
  "local-estimate",
  "unknown",
]);
export const usageQualitySchema = z.enum(["exact", "derived", "estimated"]);
export const provenanceSourceSchema = z.enum([
  "sdk-event",
  "otel",
  "cli-jsonl",
  "app-server",
  "session-log",
  "billing-api",
  "sqlite",
]);

const nonNegative = z.number().min(0);

export const providerUnitSchema = z.object({
  name: z.string().min(1),
  amount: z.number(),
});

export const tokenUsageSchema = z.object({
  scope: usageScopeSchema,
  /** Total input tokens INCLUDING cached and cache-write tokens (cached ⊆ input). */
  inputTokens: nonNegative.optional(),
  cachedInputTokens: nonNegative.optional(),
  cacheWriteTokens: nonNegative.optional(),
  /** Subset of cacheWriteTokens written with a long (1h) TTL, which some providers price higher. */
  cacheWriteLongTtlTokens: nonNegative.optional(),
  /** Total output tokens INCLUDING reasoning tokens (reasoning ⊆ output). */
  outputTokens: nonNegative.optional(),
  reasoningTokens: nonNegative.optional(),
  /** inputTokens + outputTokens. Never adds cached/reasoning again. */
  totalTokens: nonNegative.optional(),
});

export const usageEventSchema = z.object({
  schemaVersion: z.literal("1"),
  /** Idempotency key. Ingesting the same telemetry twice must yield the same key. */
  eventKey: z.string().min(1),
  provider: providerSchema,
  adapter: z.object({ version: z.string() }),
  timestamp: z.string(),
  run: z.object({
    runId: z.string().min(1),
    /** Working directory of the run (used to map runs to customers/projects). */
    project: z.string().optional(),
    providerSessionId: z.string().optional(),
    providerThreadId: z.string().optional(),
    rootThreadId: z.string().optional(),
    parentThreadId: z.string().optional(),
    turnId: z.string().optional(),
    requestId: z.string().optional(),
  }),
  actor: z.object({
    kind: actorKindSchema,
    id: z.string().optional(),
    name: z.string().optional(),
    parentId: z.string().optional(),
    depth: z.number().int().min(0).optional(),
  }),
  model: z.object({
    requested: z.string().optional(),
    reported: z.string().optional(),
  }),
  usage: tokenUsageSchema,
  billing: z.object({
    mode: billingModeSchema,
    providerUnit: providerUnitSchema.optional(),
    /** Further provider meters on the same call (Copilot: premium requests next to AI credits). Reported, never summed with providerUnit. */
    extraUnits: z.array(providerUnitSchema).optional(),
    estimatedListPriceUsd: z.number().optional(),
    reportedCostUsd: z.number().optional(),
    billedUsd: z.number().optional(),
    certainty: costCertaintySchema,
    rateCardId: z.string().optional(),
  }),
  provenance: z.object({
    source: provenanceSourceSchema,
    quality: usageQualitySchema,
    providerVersion: z.string().optional(),
    rawEventId: z.string().optional(),
    sourcePath: z.string().optional(),
  }),
});

/** A hierarchy/identity fact about an actor, reported separately from usage. */
export const actorFactSchema = z.object({
  runId: z.string().min(1),
  provider: providerSchema,
  id: z.string().min(1),
  kind: actorKindSchema,
  name: z.string().optional(),
  description: z.string().optional(),
  parentId: z.string().optional(),
  model: z.string().optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  /** Path-like strings found in the actor's task prompt (run folders, output files). Used to join actors to external work units. */
  refs: z.array(z.string()).optional(),
});

export const runFactSchema = z.object({
  runId: z.string().min(1),
  provider: providerSchema,
  providerSessionId: z.string(),
  project: z.string().optional(),
  startedAt: z.string().optional(),
  providerVersion: z.string().optional(),
  billingMode: billingModeSchema,
  label: z.string().optional(),
});
