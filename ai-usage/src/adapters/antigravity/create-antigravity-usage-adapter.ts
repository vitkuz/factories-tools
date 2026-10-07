import type { UsageAdapter } from "../../contract/adapter.types.js";
import { streamFromRead } from "../adapter.utils.js";
import type { AntigravityAdapterSettings } from "./antigravity.types.js";
import { ANTIGRAVITY_ADAPTER_VERSION, ANTIGRAVITY_PROVIDER } from "./antigravity.utils.js";
import { readAntigravityConversations } from "./conversation-reader.js";

export const createAntigravityUsageAdapter = (
  settings: AntigravityAdapterSettings,
): UsageAdapter => {
  const read: UsageAdapter["read"] = (cursor) => readAntigravityConversations(settings, cursor);
  return {
    provider: ANTIGRAVITY_PROVIDER,
    version: ANTIGRAVITY_ADAPTER_VERSION,
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
