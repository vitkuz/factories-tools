import type { TokenUsage } from "../contract/usage-event.types.js";
import type { TokenTotals } from "../contract/usage-summary.types.js";

export const emptyTotals = (): TokenTotals => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
});

/**
 * Total tokens = input + output. Cached input is a subset of input and reasoning
 * output is a subset of output, so neither is added again.
 */
export const computeTotalTokens = (
  usage: Pick<TokenUsage, "inputTokens" | "outputTokens">,
): number => (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);

export const usageToTotals = (usage: TokenUsage): TokenTotals => ({
  inputTokens: usage.inputTokens ?? 0,
  cachedInputTokens: usage.cachedInputTokens ?? 0,
  cacheWriteTokens: usage.cacheWriteTokens ?? 0,
  outputTokens: usage.outputTokens ?? 0,
  reasoningTokens: usage.reasoningTokens ?? 0,
  totalTokens: computeTotalTokens(usage),
});

export const addTotals = (a: TokenTotals, b: TokenTotals): TokenTotals => ({
  inputTokens: a.inputTokens + b.inputTokens,
  cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  totalTokens: a.totalTokens + b.totalTokens,
});

export const subtractTotals = (a: TokenTotals, b: TokenTotals): TokenTotals => ({
  inputTokens: a.inputTokens - b.inputTokens,
  cachedInputTokens: a.cachedInputTokens - b.cachedInputTokens,
  cacheWriteTokens: a.cacheWriteTokens - b.cacheWriteTokens,
  outputTokens: a.outputTokens - b.outputTokens,
  reasoningTokens: a.reasoningTokens - b.reasoningTokens,
  totalTokens: a.totalTokens - b.totalTokens,
});

export const sumTotals = (items: TokenTotals[]): TokenTotals =>
  items.reduce(addTotals, emptyTotals());
