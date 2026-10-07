import { describe, expect, it } from "vitest";
import { BUILTIN_REGISTRY_DIR, createRateCardResolver } from "../src/pricing/index.js";
import { normalizeModelId } from "../src/shared/utils/model.utils.js";

const resolve = createRateCardResolver({ registryDirs: [BUILTIN_REGISTRY_DIR] });

describe("rate card resolver", () => {
  it("normalizes model spellings", () => {
    expect(normalizeModelId("claude-opus-4.6")).toBe("claude-opus-4-6");
    expect(normalizeModelId("claude-opus-5[1m]")).toBe("claude-opus-5");
    expect(normalizeModelId("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
    expect(normalizeModelId("gpt-5.5")).toBe("gpt-5-5");
  });
  it("finds Anthropic and OpenAI cards and returns null for unknown models", async () => {
    expect(
      (
        await resolve({
          provider: "anthropic-claude",
          model: "claude-haiku-4-5-20251001",
          timestamp: "2026-09-01",
          billingMode: "subscription",
        })
      )?.id,
    ).toBe("anthropic/claude-haiku-4-5/2025-10-15");
    expect(
      (
        await resolve({
          provider: "openai-codex",
          model: "gpt-5.5",
          timestamp: "2026-09-01",
          billingMode: "subscription",
        })
      )?.id,
    ).toBe("openai/gpt-5-5/2026-04-01");
    expect(
      await resolve({
        provider: "openai-codex",
        model: "gpt-99",
        timestamp: "2026-09-01",
        billingMode: "subscription",
      }),
    ).toBeNull();
  });
  it("respects effective dates (historical runs keep historical cards)", async () => {
    expect(
      await resolve({
        provider: "anthropic-claude",
        model: "claude-opus-5",
        timestamp: "2026-01-01",
        billingMode: "api-payg",
      }),
    ).toBeNull();
    expect(
      (
        await resolve({
          provider: "anthropic-claude",
          model: "claude-opus-5",
          timestamp: "2026-06-01",
          billingMode: "api-payg",
        })
      )?.id,
    ).toBe("anthropic/claude-opus-5/2026-05-01");
  });
  it("prices claude-opus-5-5 with its own card, not the claude-opus-5 one", async () => {
    expect(
      (
        await resolve({
          provider: "anthropic-claude",
          model: "claude-opus-5-5",
          timestamp: "2026-09-26",
          billingMode: "subscription",
        })
      )?.id,
    ).toBe("anthropic/claude-opus-5-5/2026-09-23");
  });
  it("copilot wildcard card only provides the credit conversion", async () => {
    const card = await resolve({
      provider: "github-copilot",
      model: "claude-opus-4.6",
      timestamp: "2026-09-01",
      billingMode: "provider-credits",
    });
    expect(card?.providerCreditConversion).toEqual({ unit: "github_ai_credit", usdPerUnit: 0.01 });
    expect(card?.inputPerMillion).toBeUndefined();
  });
});
