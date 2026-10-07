import type { UsageAdapter } from "../../contract/adapter.types.js";
import { streamFromRead } from "../adapter.utils.js";
import type { ClaudeAdapterSettings } from "./claude.types.js";
import { CLAUDE_ADAPTER_VERSION, CLAUDE_PROVIDER } from "./claude.utils.js";
import { readClaudeTranscripts } from "./transcript-reader.js";

export const createClaudeUsageAdapter = (settings: ClaudeAdapterSettings): UsageAdapter => {
  const read: UsageAdapter["read"] = (cursor) => readClaudeTranscripts(settings, cursor);
  return {
    provider: CLAUDE_PROVIDER,
    version: CLAUDE_ADAPTER_VERSION,
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
