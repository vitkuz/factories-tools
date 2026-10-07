import { describe, expect, it } from "vitest";
import {
  buildRunUsageSummary,
  calculateEstimatedCost,
  computeTotalTokens,
  deduplicateUsageEvents,
  priceUsageEvents,
  reconcileUsage,
} from "../src/aggregation/index.js";
import type { RateCard } from "../src/contract/rate-card.types.js";
import { usageEventSchema } from "../src/contract/usage-event.schema.js";
import { makeEvent } from "./helpers.js";

const card: RateCard = {
  id: "t/opus/2026",
  provider: "anthropic-claude",
  model: "claude-opus-5",
  aliases: [],
  effectiveFrom: "2026-01-01",
  billingMode: "api-payg",
  inputPerMillion: 5,
  cachedInputPerMillion: 0.5,
  cacheWritePerMillion: 6.25,
  outputPerMillion: 25,
  currency: "USD",
  source: "test",
};

describe("token rule", () => {
  it("total = input + output; cached and reasoning are never added again", () => {
    expect(computeTotalTokens({ inputTokens: 1000, outputTokens: 200 })).toBe(1200);
  });
  it("prices uncached/cached/cache-write/output separately", () => {
    const usd: number | null = calculateEstimatedCost(
      {
        scope: "request",
        inputTokens: 1000,
        cachedInputTokens: 400,
        cacheWriteTokens: 100,
        outputTokens: 200,
      },
      card,
    );
    // 500 uncached * 5 + 400 * 0.5 + 100 * 6.25 + 200 * 25  (per million)
    expect(usd).toBeCloseTo((500 * 5 + 400 * 0.5 + 100 * 6.25 + 200 * 25) / 1e6, 10);
  });
  it("returns null (unknown) when the card has no token rates", () => {
    expect(
      calculateEstimatedCost(
        { scope: "request", inputTokens: 1, outputTokens: 1 },
        { ...card, inputPerMillion: undefined },
      ),
    ).toBeNull();
  });
});

describe("deduplication / idempotency", () => {
  it("same eventKey ingested twice counts once, last wins", () => {
    const a = makeEvent({ key: "k1" });
    const b = makeEvent({
      key: "k1",
      usage: { scope: "request", inputTokens: 5, outputTokens: 5, totalTokens: 10 },
    });
    const out = deduplicateUsageEvents([a, a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]?.usage.totalTokens).toBe(10);
  });
  it("summary is identical when the same events are ingested twice", () => {
    const events = [makeEvent({ key: "a" }), makeEvent({ key: "b" })];
    const once = buildRunUsageSummary({ runId: "anthropic-claude:run-1", events, actors: [] });
    const twice = buildRunUsageSummary({
      runId: "anthropic-claude:run-1",
      events: [...events, ...events],
      actors: [],
    });
    expect(twice.totals).toEqual(once.totals);
    expect(twice.requestCount).toBe(2);
  });
});

describe("cumulative protection + reconciliation", () => {
  it("session-cumulative events are never summed as requests", () => {
    const events = [
      makeEvent({ key: "r1" }),
      makeEvent({ key: "r2" }),
      makeEvent({
        key: "c",
        usage: {
          scope: "session-cumulative",
          inputTokens: 2000,
          outputTokens: 400,
          totalTokens: 2400,
        },
      }),
    ];
    const s = buildRunUsageSummary({ runId: "anthropic-claude:run-1", events, actors: [] });
    expect(s.requestCount).toBe(2);
    expect(s.totals.totalTokens).toBe(2400);
    expect(s.reconciliation.status).toBe("exact");
  });
  it("difference between attributed and provider total becomes 'unattributed', main is not inflated", () => {
    const events = [
      makeEvent({ key: "m", actor: { kind: "main", id: "main" } }),
      makeEvent({ key: "s", actor: { kind: "subagent", id: "agent-1", parentId: "main" } }),
      makeEvent({
        key: "c",
        usage: {
          scope: "session-cumulative",
          inputTokens: 2500,
          outputTokens: 400,
          totalTokens: 2900,
        },
      }),
    ];
    const s = buildRunUsageSummary({ runId: "anthropic-claude:run-1", events, actors: [] });
    expect(s.reconciliation.status).toBe("difference");
    expect(s.reconciliation.unattributedTokens).toBe(500);
    const main = s.actors.find((a) => a.id === "main");
    const un = s.actors.find((a) => a.kind === "unattributed");
    expect(main?.totals.totalTokens).toBe(1200);
    expect(un?.totals.totalTokens).toBe(500);
    expect(s.totals.totalTokens).toBe(2900);
  });
  it("latest cumulative snapshot wins", () => {
    const r = reconcileUsage(
      [makeEvent({ key: "r" })],
      [
        makeEvent({
          key: "c1",
          timestamp: "2026-09-01T00:00:01Z",
          usage: {
            scope: "session-cumulative",
            inputTokens: 100,
            outputTokens: 0,
            totalTokens: 100,
          },
        }),
        makeEvent({
          key: "c2",
          timestamp: "2026-09-01T00:00:02Z",
          usage: {
            scope: "session-cumulative",
            inputTokens: 1000,
            outputTokens: 200,
            totalTokens: 1200,
          },
        }),
      ],
    );
    expect(r.status).toBe("exact");
  });
});

describe("pricing priority / unknown prices", () => {
  it("unknown model → cost unknown, usage still returned", async () => {
    const priced = await priceUsageEvents(async () => null)([
      makeEvent({ key: "x", model: { reported: "mystery-model" } }),
    ]);
    const s = buildRunUsageSummary({ runId: "anthropic-claude:run-1", events: priced, actors: [] });
    expect(s.billing.estimatedListPriceUsd).toBeUndefined();
    expect(s.billing.certainty).toBe("unknown");
    expect(s.billing.unpricedTokens).toBe(1200);
    expect(s.totals.totalTokens).toBe(1200);
  });
  it("subscription runs get a list-price estimate but billedUsd stays unknown", async () => {
    const priced = await priceUsageEvents(async () => card)([makeEvent({ key: "x" })]);
    const s = buildRunUsageSummary({ runId: "anthropic-claude:run-1", events: priced, actors: [] });
    expect(s.billing.estimatedListPriceUsd).toBeGreaterThan(0);
    expect(s.billing.billedUsd).toBeUndefined();
    expect(s.billing.certainty).toBe("local-estimate");
    expect(s.billing.rateCardIds).toEqual(["t/opus/2026"]);
  });
  it("provider-reported cost is kept separate as provider-estimate", () => {
    const events = [
      makeEvent({ key: "r" }),
      makeEvent({
        key: "c",
        usage: {
          scope: "session-cumulative",
          inputTokens: 1000,
          outputTokens: 200,
          totalTokens: 1200,
        },
        billing: { mode: "subscription", certainty: "provider-estimate", reportedCostUsd: 0.5 },
      }),
    ];
    const s = buildRunUsageSummary({ runId: "anthropic-claude:run-1", events, actors: [] });
    expect(s.billing.reportedCostUsd).toBe(0.5);
    expect(s.billing.billedUsd).toBeUndefined();
  });
});

describe("hierarchy", () => {
  it("nested main → A → B → C is preserved with depths", () => {
    const events = [
      makeEvent({ key: "m" }),
      makeEvent({ key: "a", actor: { kind: "subagent", id: "A", parentId: "main" } }),
      makeEvent({ key: "b", actor: { kind: "subagent", id: "B", parentId: "A" } }),
      makeEvent({ key: "c", actor: { kind: "subagent", id: "C", parentId: "B" } }),
    ];
    const s = buildRunUsageSummary({ runId: "anthropic-claude:run-1", events, actors: [] });
    expect(s.actors.map((a) => [a.id, a.depth])).toEqual([
      ["main", 0],
      ["A", 1],
      ["B", 2],
      ["C", 3],
    ]);
  });
  it("events validate against the contract schema", () => {
    expect(usageEventSchema.safeParse(makeEvent({ key: "v" })).success).toBe(true);
  });
});
