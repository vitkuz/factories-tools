import type { SourceCursor, UsageAdapter, AdapterReadResult } from "../contract/adapter.types.js";
import type { UsageEvent } from "../contract/usage-event.types.js";
import { computeTotalTokens } from "../aggregation/totals.js";
import type { TokenUsage } from "../contract/usage-event.types.js";

export const nowIso = (): string => new Date().toISOString();

export const withTotal = (usage: TokenUsage): TokenUsage => ({
  ...usage,
  totalTokens: computeTotalTokens(usage),
});

export const streamFromRead = (read: UsageAdapter["read"]) =>
  async function* (cursor?: SourceCursor): AsyncIterable<UsageEvent> {
    const result: AdapterReadResult = await read(cursor ?? {});
    for (const event of result.events) yield event;
  };

export const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const REF_PATTERNS: RegExp[] = [/\brun\/[\w.-]+\/[\w.-]+/g, /\b\d{1,3}-[a-z][\w-]*\/[^\s"'`),;]*/g];

/** Path-like references in a task prompt: run folders and numbered step output files. Provider-neutral. */
export const extractPromptRefs = (text: string): string[] =>
  Array.from(
    new Set<string>(REF_PATTERNS.flatMap((re: RegExp): string[] => text.match(re) ?? [])),
  ).slice(0, 64);
