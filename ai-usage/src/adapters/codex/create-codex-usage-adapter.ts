import type { UsageAdapter } from "../../contract/adapter.types.js";
import { streamFromRead } from "../adapter.utils.js";
import type { CodexAdapterSettings } from "./codex.types.js";
import { CODEX_ADAPTER_VERSION, CODEX_PROVIDER } from "./codex.utils.js";
import { readCodexRollouts } from "./rollout-reader.js";

export const createCodexUsageAdapter = (settings: CodexAdapterSettings): UsageAdapter => {
  const read: UsageAdapter["read"] = (cursor) => readCodexRollouts(settings, cursor);
  return {
    provider: CODEX_PROVIDER,
    version: CODEX_ADAPTER_VERSION,
    capabilities: {
      liveUsage: true,
      perAgentUsage: true,
      hierarchy: true,
      modelUsage: true,
      tokenUsage: true,
      providerCost: false,
      authoritativeCost: false,
    },
    read,
    stream: streamFromRead(read),
  };
};
