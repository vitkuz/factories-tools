import type { BillingMode } from "../../contract/usage-event.types.js";

export type AntigravityAdapterSettings = {
  /** ~/.gemini/antigravity-cli */
  homeDir: string;
  billingMode: BillingMode;
  pythonBin: string;
  projectFilter?: string[];
  /** Injected for tests: replaces the python decoder. */
  decode?: (files: string[]) => Promise<AntigravityConversation[]>;
};

export type AntigravityGeneration = {
  idx: number;
  genId?: string | null;
  model?: string | null;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  timestamp?: string | null;
};

export type AntigravityConversation = {
  id: string;
  workspace?: string | null;
  parentId?: string | null;
  agentName?: string | null;
  startedAt?: string | null;
  updatedAt?: string | null;
  firstPrompt: string;
  generations: AntigravityGeneration[];
};
