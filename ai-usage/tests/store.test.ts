import { describe, expect, it } from "vitest";
import { createUsageStore } from "../src/storage/usage-store.js";
import { makeEvent, tmpDir } from "./helpers.js";

describe("usage store", () => {
  it("append is idempotent on eventKey and survives re-ingest", async () => {
    const store = createUsageStore(await tmpDir());
    const a = await store.appendEvents([makeEvent({ key: "1" }), makeEvent({ key: "2" })]);
    const b = await store.appendEvents([makeEvent({ key: "2" }), makeEvent({ key: "3" })]);
    expect(a).toEqual({ appended: 2, skipped: 0 });
    expect(b).toEqual({ appended: 1, skipped: 1 });
    expect((await store.loadEvents()).map((e) => e.eventKey)).toEqual(["1", "2", "3"]);
  });
  it("cursors are stored per provider", async () => {
    const store = createUsageStore(await tmpDir());
    await store.saveCursor("openai-codex", { "/f": { offset: 10, updatedAt: "t" } });
    await store.saveCursor("anthropic-claude", { "/g": { offset: 5, updatedAt: "t" } });
    expect(await store.loadCursor("openai-codex")).toEqual({
      "/f": { offset: 10, updatedAt: "t" },
    });
    expect(await store.loadCursor("github-copilot")).toEqual({});
  });
});
