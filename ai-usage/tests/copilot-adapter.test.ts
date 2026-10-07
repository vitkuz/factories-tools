import path from "node:path";
import fsp from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  checkpointToEvent,
  createCopilotUsageAdapter,
  usageRowToEvent,
} from "../src/adapters/copilot/index.js";
import { buildRunUsageSummary, priceUsageEvents } from "../src/aggregation/index.js";
import { BUILTIN_REGISTRY_DIR, createRateCardResolver } from "../src/pricing/index.js";
import type { SqliteQuery } from "../src/adapters/sqlite/python-sqlite.adapter.js";
import { FIXTURES } from "./helpers.js";

const homeDir: string = path.join(FIXTURES, "copilot/subagents");

const fakeQuery = async (): Promise<SqliteQuery> => {
  const rows = JSON.parse(
    await fsp.readFile(path.join(homeDir, "usage-rows.json"), "utf8"),
  ) as Array<Record<string, unknown> & { id: number }>;
  const sessions = JSON.parse(
    await fsp.readFile(path.join(homeDir, "sessions.json"), "utf8"),
  ) as Array<Record<string, unknown>>;
  return async (sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> =>
    sql.includes("FROM assistant_usage_events")
      ? rows.filter((r) => r.id > (params[0] as number))
      : sessions;
};

describe("copilot adapter", () => {
  it("attributes per-call usage and AI credits to main and named subagents; credits convert to USD", async () => {
    const adapter = createCopilotUsageAdapter({
      homeDir,
      billingMode: "provider-credits",
      pythonBin: "python3",
      query: await fakeQuery(),
    });
    const result = await adapter.read({});
    const priced = await priceUsageEvents(
      createRateCardResolver({ registryDirs: [BUILTIN_REGISTRY_DIR] }),
    )(result.events);
    const runId = result.events[0]?.run.runId as string;
    const s = buildRunUsageSummary({
      runId,
      events: priced,
      actors: result.actors,
      run: result.runs[0],
    });

    expect(s.requestCount).toBe(431);
    const subs = s.actors.filter((a) => a.kind === "subagent");
    expect(subs.length).toBeGreaterThan(0);
    expect(subs.every((a) => a.name !== undefined && a.parentId === "main")).toBe(true);
    const credits = s.billing.providerUnits.find((u) => u.name === "github_ai_credit");
    expect(credits?.amount).toBeGreaterThan(0);
    // 1 credit = $0.01 (attributed portion only)
    const attributed = s.actors
      .filter((a) => a.kind !== "unattributed")
      .reduce((acc, a) => acc + (a.billing.providerUnits[0]?.amount ?? 0), 0);
    expect(s.billing.estimatedListPriceUsd).toBeCloseTo(attributed * 0.01, 6);
    expect(s.billing.billedUsd).toBeUndefined();
    // this fixture session never wrote a usage checkpoint => reconciliation must say so, not guess
    expect(s.reconciliation.status).toBe("unavailable");
  });

  it("reconciles attributed credits against the session usage checkpoint", () => {
    const ctx = { billingMode: "provider-credits" as const, sourcePath: "x", subagents: new Map() };
    const row = {
      id: 1,
      session_id: "s",
      turn_index: 0,
      agent_id: null,
      parent_tool_call_id: null,
      model: "gpt-5.4",
      input_tokens: 100,
      output_tokens: 10,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
      total_nano_aiu: 1_500_000_000,
      request_multiplier: 1,
      initiator: "user",
      api_endpoint: "/x",
      reasoning_effort: null,
      created_at: "2026-09-01T00:00:00Z",
    };
    const events = [
      usageRowToEvent(row, ctx),
      checkpointToEvent("s", { nanoAiu: 2_000_000_000, timestamp: "2026-09-01T00:00:01Z" }, ctx),
    ];
    const s = buildRunUsageSummary({ runId: "github-copilot:s", events, actors: [] });
    expect(s.reconciliation.status).toBe("difference");
    expect(s.reconciliation.unattributedProviderUnit).toEqual({
      name: "github_ai_credit",
      amount: 0.5,
    });
    expect(s.actors.find((a) => a.kind === "unattributed")?.billing.providerUnits).toEqual([
      { name: "github_ai_credit", amount: 0.5 },
    ]);
    expect(s.actors.find((a) => a.kind === "main")?.billing.providerUnits).toEqual([
      { name: "github_ai_credit", amount: 1.5 },
      { name: "github_premium_request", amount: 1 },
    ]);
  });

  it("is idempotent across cursor resume", async () => {
    const adapter = createCopilotUsageAdapter({
      homeDir,
      billingMode: "provider-credits",
      pythonBin: "python3",
      query: await fakeQuery(),
    });
    const first = await adapter.read({});
    const second = await adapter.read(first.cursor);
    expect(second.events).toHaveLength(0);
  });
});

describe("copilot ≥1.0.8x subagent identity", () => {
  it("joins usage-row agent_id (UUID) with subagent.started and takes refs from the task prompt", async () => {
    const { extractSubagents, subagentToActorFact } =
      await import("../src/adapters/copilot/index.js");
    const events = [
      {
        type: "tool.execution_start",
        data: {
          toolName: "task",
          toolCallId: "toolu_1",
          arguments: {
            agent_type: "research",
            description: "Research bitcoin",
            prompt:
              "Write to run/research-factory/bitcoin-2026-09-03/2-research/findings.md after reading 1-plan-research/plan.md",
          },
        },
      },
      {
        type: "subagent.started",
        agentId: "uuid-1",
        timestamp: "2026-09-02T21:05:36Z",
        data: {
          toolCallId: "toolu_1",
          agentName: "research",
          agentType: "research",
          model: "gpt-5.4",
        },
      },
      {
        type: "subagent.completed",
        agentId: "uuid-1",
        timestamp: "2026-09-02T21:10:20Z",
        data: { toolCallId: "toolu_1", agentName: "research", totalTokens: 1000 },
      },
    ];
    const map = extractSubagents(events);
    expect(map.get("uuid-1")).toBe(map.get("toolu_1"));
    const fact = subagentToActorFact("s", map.get("uuid-1")!);
    expect(fact.id).toBe("uuid-1");
    expect(fact.name).toBe("research");
    expect(fact.refs).toEqual([
      "run/research-factory/bitcoin-2026-09-03",
      "2-research/findings.md",
      "1-plan-research/plan.md",
    ]);
    expect(fact.startedAt).toBe("2026-09-02T21:05:36Z");
  });
});

describe("copilot premium requests", () => {
  it("charges the model multiplier per user prompt only, and the session total lands in the summary", async () => {
    const { usageRowToEvent } = await import("../src/adapters/copilot/index.js");
    const ctx = { billingMode: "provider-credits" as const, sourcePath: "x", subagents: new Map() };
    const base = {
      id: 1,
      session_id: "s",
      turn_index: 0,
      agent_id: null,
      parent_tool_call_id: null,
      model: "claude-opus-4.6",
      input_tokens: 10,
      output_tokens: 1,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
      total_nano_aiu: 1e9,
      request_multiplier: 3,
      api_endpoint: "/x",
      reasoning_effort: null,
      created_at: "2026-09-01T00:00:00Z",
    };
    const user = usageRowToEvent({ ...base, initiator: "user" }, ctx);
    const agent = usageRowToEvent({ ...base, id: 2, initiator: "agent" }, ctx);
    expect(user.billing.extraUnits).toEqual([{ name: "github_premium_request", amount: 3 }]);
    expect(agent.billing.extraUnits).toBeUndefined();
    const s = buildRunUsageSummary({
      runId: "github-copilot:s",
      events: [user, agent],
      actors: [],
    });
    expect(s.billing.providerUnits).toEqual([
      { name: "github_ai_credit", amount: 2 },
      { name: "github_premium_request", amount: 3 },
    ]);
  });
});
