import path from "node:path";
import fsp from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createCodexUsageAdapter, parseCodexExecJsonl } from "../src/adapters/codex/index.js";
import { buildRunUsageSummary } from "../src/aggregation/index.js";
import { FIXTURES } from "./helpers.js";

describe("codex rollout adapter", () => {
  it("per-request deltas sum exactly to the session total", async () => {
    const adapter = createCodexUsageAdapter({
      homeDir: path.join(FIXTURES, "codex/basic"),
      billingMode: "subscription",
    });
    const result = await adapter.read({});
    const runId = result.events[0]?.run.runId as string;
    const s = buildRunUsageSummary({
      runId,
      events: result.events,
      actors: result.actors,
      run: result.runs[0],
    });
    expect(s.reconciliation.status).toBe("exact");
    expect(s.requestCount).toBeGreaterThan(50);
    expect(s.totals.totalTokens).toBe(2878751);
    expect(s.models[0]?.model).toBe("gpt-5.5");
    expect(s.actors.find((a) => a.kind === "main")?.totals.totalTokens).toBe(2878751);
  });

  it("child thread replaying parent history does not inflate the run", async () => {
    const adapter = createCodexUsageAdapter({
      homeDir: path.join(FIXTURES, "codex/replay"),
      billingMode: "subscription",
    });
    const expected = JSON.parse(
      await fsp.readFile(path.join(FIXTURES, "codex/replay/expected.json"), "utf8"),
    ) as { parentTotal: number; childOwn: number };
    const result = await adapter.read({});
    const runIds = new Set(result.events.map((e) => e.run.runId));
    expect(runIds.size).toBe(1);
    const s = buildRunUsageSummary({
      runId: [...runIds][0] as string,
      events: result.events,
      actors: result.actors,
      run: result.runs[0],
    });
    expect(s.totals.totalTokens).toBe(expected.parentTotal + expected.childOwn);
    expect(s.reconciliation.status).toBe("exact");
    const child = s.actors.find((a) => a.kind === "subagent");
    expect(child?.name).toBe("scout");
    expect(child?.parentId).toBe("main");
    expect(child?.totals.totalTokens).toBe(expected.childOwn);
    // duplicated token_count heartbeat is ignored
    expect(child?.requestCount).toBe(2);
  });

  it("resume mid-file continues with the same totals", async () => {
    const homeDir: string = path.join(FIXTURES, "codex/basic");
    const adapter = createCodexUsageAdapter({ homeDir, billingMode: "subscription" });
    const full = await adapter.read({});
    const file: string = Object.keys(full.cursor)[0] as string;
    const content: string = await fsp.readFile(file, "utf8");
    const half: number = content.indexOf("\n", Math.floor(content.length / 2)) + 1;
    // simulate a cursor that stopped mid-file by re-reading from a smaller offset with the adapter's own state machine
    const partial = await adapter.read({});
    const resumed = await adapter.read({ [file]: { offset: half, state: {}, updatedAt: "x" } });
    expect(partial.events.length).toBe(full.events.length);
    expect(resumed.events.length).toBeGreaterThan(0);
    expect(resumed.events.length).toBeLessThan(full.events.length);
    expect((await adapter.read(full.cursor)).events.length).toBe(0);
  });

  it("parses codex exec --json turn.completed usage", () => {
    const lines: string[] = [
      JSON.stringify({ type: "thread.started", thread_id: "t1" }),
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 1000, cached_input_tokens: 600, output_tokens: 50 },
      }),
    ];
    const events = parseCodexExecJsonl(lines, {
      billingMode: "api-payg",
      sourcePath: "x",
      timestamp: "2026-09-02T00:00:00Z",
      model: "gpt-5.5",
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.usage).toMatchObject({
      scope: "turn",
      inputTokens: 1000,
      cachedInputTokens: 600,
      outputTokens: 50,
      totalTokens: 1050,
    });
  });
});
