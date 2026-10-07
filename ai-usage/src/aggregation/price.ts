import type { RateCard, ResolveRateCard } from "../contract/rate-card.types.js";
import type { TokenUsage, UsageEvent } from "../contract/usage-event.types.js";

const perMillion = (tokens: number, rate: number): number => (tokens / 1_000_000) * rate;

/**
 * List-price estimate for one usage record.
 * input is split into uncached / cached / cache-write parts since each has its own rate.
 * Returns null when the card cannot price the tokens (never invents a price).
 */
export const calculateEstimatedCost = (usage: TokenUsage, card: RateCard): number | null => {
  const input: number = usage.inputTokens ?? 0;
  const cached: number = usage.cachedInputTokens ?? 0;
  const cacheWrite: number = usage.cacheWriteTokens ?? 0;
  const output: number = usage.outputTokens ?? 0;
  if (card.inputPerMillion === undefined || card.outputPerMillion === undefined) return null;
  const uncached: number = Math.max(0, input - cached - cacheWrite);
  const cachedRate: number = card.cachedInputPerMillion ?? card.inputPerMillion;
  const cacheWriteRate: number = card.cacheWritePerMillion ?? card.inputPerMillion;
  const longTtl: number = Math.min(cacheWrite, usage.cacheWriteLongTtlTokens ?? 0);
  const longTtlRate: number = card.cacheWriteLongTtlPerMillion ?? cacheWriteRate;
  return (
    perMillion(uncached, card.inputPerMillion) +
    perMillion(cached, cachedRate) +
    perMillion(cacheWrite - longTtl, cacheWriteRate) +
    perMillion(longTtl, longTtlRate) +
    perMillion(output, card.outputPerMillion)
  );
};

const round = (n: number): number => Math.round(n * 1e8) / 1e8;

/**
 * Fills billing.estimatedListPriceUsd / rateCardId following the priority:
 * provider-reported credits (converted via the card) > token rate card > unknown.
 * Never overwrites a value the adapter already reported.
 */
export const priceUsageEvent =
  (resolve: ResolveRateCard) =>
  async (event: UsageEvent): Promise<UsageEvent> => {
    if (event.billing.estimatedListPriceUsd !== undefined) return event;
    const model: string | undefined = event.model.reported ?? event.model.requested;
    if (!model) return event;
    const card: RateCard | null = await resolve({
      provider: event.provider,
      model,
      timestamp: event.timestamp,
      billingMode: event.billing.mode,
    });
    if (!card) return event;

    const fromUnit: number | null =
      event.billing.providerUnit && card.providerCreditConversion
        ? event.billing.providerUnit.name === card.providerCreditConversion.unit
          ? event.billing.providerUnit.amount * card.providerCreditConversion.usdPerUnit
          : null
        : null;
    const fromTokens: number | null =
      fromUnit === null ? calculateEstimatedCost(event.usage, card) : null;
    const price: number | null = fromUnit ?? fromTokens;
    if (price === null) return event;
    return {
      ...event,
      billing: {
        ...event.billing,
        estimatedListPriceUsd: round(price),
        rateCardId: card.id,
        certainty:
          event.billing.certainty === "unknown" ? "local-estimate" : event.billing.certainty,
      },
    };
  };

export const priceUsageEvents =
  (resolve: ResolveRateCard) =>
  async (events: UsageEvent[]): Promise<UsageEvent[]> =>
    Promise.all(events.map(priceUsageEvent(resolve)));
