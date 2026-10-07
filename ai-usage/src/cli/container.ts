import path from "node:path";
import fsp from "node:fs/promises";
import env from "../shared/config/env.js";
import type { UsageAdapter } from "../contract/adapter.types.js";
import type { ResolveRateCard } from "../contract/rate-card.types.js";
import type { BillingMode } from "../contract/usage-event.types.js";
import { createClaudeUsageAdapter } from "../adapters/claude/index.js";
import { createCodexUsageAdapter, readCodexAuthMode } from "../adapters/codex/index.js";
import { createCopilotUsageAdapter } from "../adapters/copilot/index.js";
import { createAntigravityUsageAdapter } from "../adapters/antigravity/index.js";
import { BUILTIN_REGISTRY_DIR, createRateCardResolver } from "../pricing/index.js";
import { createUsageStore, type UsageStore } from "../storage/usage-store.js";
import { fileExists } from "../shared/utils/fs.utils.js";
import { isRecord } from "../adapters/adapter.utils.js";

export type Container = {
  store: UsageStore;
  adapters: UsageAdapter[];
  resolveRateCard: ResolveRateCard;
};

/** Claude Code: OAuth credentials with a subscriptionType => subscription; API key => api-payg. */
const detectClaudeBillingMode = async (homeDir: string): Promise<BillingMode> => {
  if (process.env.ANTHROPIC_API_KEY) return "api-payg";
  const credentials: string = path.join(homeDir, ".credentials.json");
  if (!(await fileExists(credentials))) return "unknown";
  try {
    const raw: unknown = JSON.parse(await fsp.readFile(credentials, "utf8"));
    const oauth: unknown = isRecord(raw) ? raw.claudeAiOauth : undefined;
    return isRecord(oauth) && typeof oauth.subscriptionType === "string"
      ? "subscription"
      : "unknown";
  } catch {
    return "unknown";
  }
};

export const createContainer = async (
  options: { providers?: string[]; projectFilter?: string[] } = {},
): Promise<Container> => {
  const store: UsageStore = createUsageStore(env.AI_USAGE_HOME);
  const config = await store.loadConfig();
  const resolveRateCard: ResolveRateCard = createRateCardResolver({
    registryDirs: [BUILTIN_REGISTRY_DIR, store.paths.pricingOverrides],
  });
  const wanted = (p: string): boolean =>
    !options.providers || options.providers.length === 0 || options.providers.includes(p);
  const filter = options.projectFilter ? { projectFilter: options.projectFilter } : {};

  const adapters: UsageAdapter[] = [
    ...(wanted("claude")
      ? [
          createClaudeUsageAdapter({
            homeDir: env.CLAUDE_CONFIG_DIR,
            billingMode: await detectClaudeBillingMode(env.CLAUDE_CONFIG_DIR),
            ...filter,
          }),
        ]
      : []),
    ...(wanted("codex")
      ? [
          createCodexUsageAdapter({
            homeDir: env.CODEX_HOME,
            billingMode: await readCodexAuthMode(env.CODEX_HOME),
            ...filter,
          }),
        ]
      : []),
    ...(wanted("copilot")
      ? [
          createCopilotUsageAdapter({
            homeDir: env.COPILOT_HOME,
            billingMode: "provider-credits",
            pythonBin: env.PYTHON_BIN,
            ...filter,
          }),
        ]
      : []),
    ...(wanted("antigravity")
      ? [
          createAntigravityUsageAdapter({
            homeDir: env.ANTIGRAVITY_HOME,
            billingMode: "subscription",
            pythonBin: env.PYTHON_BIN,
          }),
        ]
      : []),
  ];
  return { store, adapters, resolveRateCard };
};
