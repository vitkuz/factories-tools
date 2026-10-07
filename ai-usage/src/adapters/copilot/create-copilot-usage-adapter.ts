import type { UsageAdapter } from "../../contract/adapter.types.js";
import { streamFromRead } from "../adapter.utils.js";
import type { CopilotAdapterSettings } from "./copilot.types.js";
import { COPILOT_ADAPTER_VERSION, COPILOT_PROVIDER } from "./copilot.utils.js";
import { readCopilotSessions } from "./session-reader.js";

export const createCopilotUsageAdapter = (settings: CopilotAdapterSettings): UsageAdapter => {
  const read: UsageAdapter["read"] = (cursor) => readCopilotSessions(settings, cursor);
  return {
    provider: COPILOT_PROVIDER,
    version: COPILOT_ADAPTER_VERSION,
    capabilities: {
      liveUsage: true,
      perAgentUsage: true,
      hierarchy: true,
      modelUsage: true,
      tokenUsage: true,
      providerCost: true,
      authoritativeCost: false,
    },
    read,
    stream: streamFromRead(read),
  };
};
