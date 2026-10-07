import fsp from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createAntigravityUsageAdapter,
  normalizeAntigravityUsage,
} from "../src/adapters/antigravity/index.js";
import type { AntigravityConversation } from "../src/adapters/antigravity/index.js";
import { buildRunUsageSummary } from "../src/aggregation/index.js";
import { FIXTURES, tmpDir } from "./helpers.js";

describe("antigravity adapter", () => {
  it("normalizes usage: input excludes cache reads, output includes thinking (matches agy -p json)", () => {
    const u = normalizeAntigravityUsage(
      { idx: 0, inputTokens: 13919, cacheReadTokens: 0, outputTokens: 104, thinkingTokens: 103 },
      "request",
    );
    expect(u).toMatchObject({
      inputTokens: 13919,
      outputTokens: 104,
      reasoningTokens: 103,
      totalTokens: 14023,
    });
    const c = normalizeAntigravityUsage(
      { idx: 1, inputTokens: 2994, cacheReadTokens: 20380, outputTokens: 849, thinkingTokens: 82 },
      "request",
    );
    expect(c.inputTokens).toBe(23374);
    expect(c.cachedInputTokens).toBe(20380);
  });

  it("builds main + named subagents from parent links, with prompt refs, and resumes on fingerprints", async () => {
    const fixture = JSON.parse(
      await fsp.readFile(path.join(FIXTURES, "antigravity/research-run.json"), "utf8"),
    ) as AntigravityConversation[];
    const homeDir: string = await tmpDir();
    await fsp.mkdir(path.join(homeDir, "conversations"));
    for (const c of fixture)
      await fsp.writeFile(path.join(homeDir, "conversations", `${c.id}.db`), "x");
    const adapter = createAntigravityUsageAdapter({
      homeDir,
      billingMode: "subscription",
      pythonBin: "python3",
      decode: async () => fixture,
    });
    const first = await adapter.read({});
    const runIds = new Set(first.events.map((e) => e.run.runId));
    expect(runIds.size).toBe(1);
    const s = buildRunUsageSummary({
      runId: [...runIds][0] as string,
      events: first.events,
      actors: first.actors,
      run: first.runs[0],
    });
    const subs = s.actors.filter((a) => a.kind === "subagent");
    expect(subs.map((a) => a.name).sort()).toEqual(["Research Lead", "Researcher"]);
    expect(subs.every((a) => a.parentId === "main" && a.totals.totalTokens > 0)).toBe(true);
    expect(s.actors.find((a) => a.kind === "main")?.totals.totalTokens).toBeGreaterThan(0);
    expect(
      first.actors.every((a) => (a.refs ?? []).some((r) => r.startsWith("run/research-factory/"))),
    ).toBe(true);
    expect((await adapter.read(first.cursor)).events).toHaveLength(0);
  });
});
