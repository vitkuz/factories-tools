import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import type { UsageEvent } from "../src/contract/usage-event.types.js";

export const FIXTURES: string = path.resolve("fixtures");

export const tmpDir = async (): Promise<string> =>
  fsp.mkdtemp(path.join(os.tmpdir(), "ai-usage-test-"));

export const makeEvent = (overrides: Partial<UsageEvent> & { key: string }): UsageEvent => ({
  schemaVersion: "1",
  eventKey: overrides.key,
  provider: "anthropic-claude",
  adapter: { version: "test" },
  timestamp: "2026-09-01T00:00:00.000Z",
  run: { runId: "anthropic-claude:run-1", providerSessionId: "run-1" },
  actor: { kind: "main", id: "main" },
  model: { reported: "claude-opus-5" },
  usage: {
    scope: "request",
    inputTokens: 1000,
    cachedInputTokens: 400,
    cacheWriteTokens: 100,
    outputTokens: 200,
    reasoningTokens: 50,
    totalTokens: 1200,
  },
  billing: { mode: "subscription", certainty: "unknown" },
  provenance: { source: "cli-jsonl", quality: "exact" },
  ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== "key")),
});
