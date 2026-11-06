import path from "node:path";
import fsp from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  createClaudeUsageAdapter,
  headlessResultToEvents,
  normalizeClaudeUsage,
} from "../src/adapters/claude/index.js";
import { buildRunUsageSummary, calculateEstimatedCost } from "../src/aggregation/index.js";
import { BUILTIN_REGISTRY_DIR, createRateCardResolver } from "../src/pricing/index.js";
import type { RateCard } from "../src/contract/rate-card.types.js";
import type { ClaudeHeadlessResult } from "../src/adapters/claude/claude.types.js";
import { FIXTURES } from "./helpers.js";

const homeDir: string = path.join(FIXTURES, "claude/nested-subagents");
const adapter = createClaudeUsageAdapter({ homeDir, billingMode: "subscription" });

describe("claude transcript adapter", () => {
  it("attributes main and subagents separately, keeps nested hierarchy, dedupes repeated message ids", async () => {
    const result = await adapter.read({});
    const runIds = new Set(result.events.map((e) => e.run.runId));
    expect(runIds.size).toBe(1);
    const summary = buildRunUsageSummary({
      runId: [...runIds][0] as string,
      events: result.events,
      actors: result.actors,
      run: result.runs[0],
    });

    const main = summary.actors.find((a) => a.kind === "main");
    const subs = summary.actors.filter((a) => a.kind === "subagent");
    expect(main?.totals.totalTokens).toBeGreaterThan(0);
    expect(subs.length).toBe(11);
    expect(subs.every((s) => s.totals.totalTokens > 0)).toBe(true);
    // nested: at least one subagent whose parent is another subagent (depth 2)
    expect(subs.some((s) => s.depth === 2)).toBe(true);
    expect(subs.every((s) => s.name !== undefined)).toBe(true);

    // every distinct message id counted exactly once
    const keys = result.events.filter((e) => e.usage.scope === "request").map((e) => e.eventKey);
    expect(summary.requestCount).toBe(new Set(keys).size);
    // Anthropic-style normalisation: input includes cache tokens
    const sample = result.events.find((e) => (e.usage.cachedInputTokens ?? 0) > 0);
    expect(
      (sample?.usage.inputTokens ?? 0) >=
        (sample?.usage.cachedInputTokens ?? 0) + (sample?.usage.cacheWriteTokens ?? 0),
    ).toBe(true);
  });

  it("resumes from the cursor without re-emitting events", async () => {
    const first = await adapter.read({});
    const second = await adapter.read(first.cursor);
    expect(first.events.length).toBeGreaterThan(0);
    expect(second.events.length).toBe(0);
  });

  it("list-price estimate with 1h cache-write pricing lands within 5% of Anthropic's own estimate", async () => {
    const raw: ClaudeHeadlessResult = JSON.parse(
      await fsp.readFile(path.join(FIXTURES, "claude/headless/result.json"), "utf8"),
    );
    const [model, m] = Object.entries(raw.modelUsage ?? {})[0] as [
      string,
      NonNullable<ClaudeHeadlessResult["modelUsage"]>[string],
    ];
    const card = await createRateCardResolver({ registryDirs: [BUILTIN_REGISTRY_DIR] })({
      provider: "anthropic-claude",
      model,
      timestamp: "2026-09-02",
      billingMode: "subscription",
    });
    const usage = normalizeClaudeUsage(
      { ...raw.usage, input_tokens: m.inputTokens, output_tokens: m.outputTokens },
      "request",
    );
    const estimate = calculateEstimatedCost(usage, card as RateCard) as number;
    expect(
      Math.abs(estimate - (raw.total_cost_usd as number)) / (raw.total_cost_usd as number),
    ).toBeLessThan(0.05);
  });

  it("headless result becomes session-cumulative events with a provider estimate, not billed money", async () => {
    const raw: ClaudeHeadlessResult = JSON.parse(
      await fsp.readFile(path.join(FIXTURES, "claude/headless/result.json"), "utf8"),
    );
    const events = headlessResultToEvents(raw, {
      billingMode: "subscription",
      timestamp: "2026-09-02T12:56:00.000Z",
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.usage.scope).toBe("session-cumulative");
    expect(events[0]?.billing.reportedCostUsd).toBeCloseTo(raw.total_cost_usd as number, 10);
    expect(events[0]?.billing.certainty).toBe("provider-estimate");
    expect(events[0]?.billing.billedUsd).toBeUndefined();
  });
});

describe("claude agent meta files", () => {
  const metaHome: string = path.join(FIXTURES, "claude/meta-links");
  const metaAdapter = createClaudeUsageAdapter({ homeDir: metaHome, billingMode: "subscription" });

  it("links a nested agent to its parent from agent-*.meta.json when the parent recorded no tool_result, and records the files each agent wrote", async () => {
    const result = await metaAdapter.read({});
    const a = result.actors.find((f) => f.id === "aaaaaaaaaaaaaaaa1");
    const b = result.actors.find((f) => f.id === "bbbbbbbbbbbbbbbb2");
    expect(a?.parentId).toBe("main");
    expect(a?.name).toBe("general-purpose");
    expect(a?.description).toBe("step-one for acme");
    expect(a?.model).toBe("claude-sonnet-5-5"); // the tool_result's resolved model beats the meta alias
    expect(a?.refs).toEqual(["run/demo/acme-2026-11-01", "1-step-one/out.md"]);
    expect(a?.writes).toEqual([
      "/fixtures/claude/project/run/demo/acme-2026-11-01/1-step-one/out.md",
    ]);
    // B's parent never recorded a tool_result (still running): the meta file is the link.
    expect(b?.parentId).toBe("aaaaaaaaaaaaaaaa1");
    expect(b?.description).toBe("brand capture");
    expect(b?.writes).toEqual([
      "/fixtures/claude/project/run/demo/acme-2026-11-01/1-brand/brand.json",
    ]);
    // every transcript's usage is an event of the right actor
    const byActor = new Map<string, number>();
    result.events.forEach((e) =>
      byActor.set(e.actor.id ?? "?", (byActor.get(e.actor.id ?? "?") ?? 0) + 1),
    );
    expect(byActor.get("main")).toBe(2);
    expect(byActor.get("aaaaaaaaaaaaaaaa1")).toBe(2);
    expect(byActor.get("bbbbbbbbbbbbbbbb2")).toBe(1);
    expect(result.events.find((e) => e.actor.id === "bbbbbbbbbbbbbbbb2")?.actor.parentId).toBe(
      "aaaaaaaaaaaaaaaa1",
    );
  });
});
